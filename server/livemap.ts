// Live track map without GPS: F1 only sends car positions to F1 TV subscribers, but every
// mini-sector completion is in the free timing feed. A per-circuit calibration (built from an
// archived session at the same circuit, where GPS *is* free) tells us where each mini-sector
// boundary sits on the track outline; live, each completion snaps a car to its boundary and
// we move it along the outline at its expected pace in between.

import { join } from "node:path";
import type { TrackOutline } from "../shared/types.ts";
import { fetchJson, fetchStream, mergeTimelines, STATIC } from "./replay.ts";
import { SessionTelemetry } from "./telemetry.ts";

const CALIBRATION_DIR = join(import.meta.dir, "../.cache/calibration");
const PIT = 2064;

export interface Calibration {
  circuitKey: number;
  from: string; // session the calibration was built from
  outline: TrackOutline;
  /** Mini-sector keys ("sector.segment") in lap order, with boundary distance and median duration. */
  segments: { key: string; at: number; ms: number }[];
}

/** Mini-sector completions in a TimingData delta: [num, "s.k", status]. */
export function segmentUpdates(delta: any): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const [num, l] of Object.entries<any>(delta?.Lines ?? {})) {
    const secs = l?.Sectors;
    if (!secs || Array.isArray(secs)) continue;
    for (const [si, sec] of Object.entries<any>(secs)) {
      const segs = sec?.Segments;
      if (!segs || Array.isArray(segs)) continue;
      for (const [ki, sg] of Object.entries<any>(segs)) if (sg?.Status) out.push([num, `${si}.${ki}`, sg.Status]);
    }
  }
  return out;
}

class Polyline {
  readonly cum: number[] = [0];
  readonly length: number;
  constructor(readonly pts: [number, number][]) {
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1]! + dist(pts[i]!, pts[i - 1]!));
    this.length = this.cum.at(-1)! + dist(pts[0]!, pts.at(-1)!);
  }
  /** Arc length of the nearest outline vertex and the distance to it. */
  project(x: number, y: number): { s: number; off: number } {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < this.pts.length; i++) {
      const d = (this.pts[i]![0] - x) ** 2 + (this.pts[i]![1] - y) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { s: this.cum[bi]!, off: Math.sqrt(best) };
  }
  pointAt(s: number): [number, number] {
    s = ((s % this.length) + this.length) % this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid]! <= s) lo = mid;
      else hi = mid - 1;
    }
    const a = this.pts[lo]!;
    const b = this.pts[(lo + 1) % this.pts.length]!;
    const segLen = (lo + 1 < this.cum.length ? this.cum[lo + 1]! : this.length) - this.cum[lo]!;
    const f = segLen > 0 ? (s - this.cum[lo]!) / segLen : 0;
    return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)];
  }
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segOrder = (a: string, b: string) => {
  const [as, ak] = a.split(".").map(Number);
  const [bs, bk] = b.split(".").map(Number);
  return as! - bs! || ak! - bk!;
};

/** Builds a calibration from an archived session's TimingData + Position.z. */
export async function calibrateFrom(path: string, circuitKey: number): Promise<Calibration | null> {
  const idx = await fetchJson(`${STATIC}${path}Index.json`);
  const feeds = Object.keys(idx.Feeds ?? {});
  if (!feeds.includes("Position.z") || !feeds.includes("TimingData")) return null;
  const [hb, td, pos] = await Promise.all([
    fetchStream(path, "Heartbeat", true),
    fetchStream(path, "TimingData", true),
    fetchStream(path, "Position.z", true),
  ]);
  if (!hb.length) return null;
  const startUtc = Date.parse((hb[0]!.data as any).Utc) - hb[0]!.t;
  const tel = new SessionTelemetry();
  tel.ingest(pos, [], startUtc, 0);
  tel.indexLaps(td);
  tel.buildOutline();
  if (!tel.outline) return null;
  const line = new Polyline(tel.outline.points);

  // Where is each car when its mini-sector completion is published?
  const at = new Map<string, number[]>();
  const last = new Map<string, { key: string; t: number }>();
  const durations = new Map<string, number[]>();
  for (const e of mergeTimelines([td])) {
    const positions = tel.positionsAt(e.t);
    for (const [num, key, status] of segmentUpdates(e.data)) {
      if (status === PIT) continue;
      const p = positions[num];
      if (!p || !p[2]) continue;
      const pr = line.project(p[0], p[1]);
      if (pr.off > 300) continue; // pit lane / off the racing line
      push(at, key, pr.s);
      const prev = last.get(num);
      if (prev && e.t - prev.t < 60_000) push(durations, `${prev.key}>${key}`, e.t - prev.t);
      last.set(num, { key, t: e.t });
    }
  }
  if (at.size < 6) return null;

  const keys = [...at.keys()].sort(segOrder);
  const segments = keys.map((key, i) => {
    const prevKey = keys[(i - 1 + keys.length) % keys.length]!;
    return {
      key,
      at: circularMedian(at.get(key)!, line.length),
      ms: median(durations.get(`${prevKey}>${key}`) ?? []) || 8_000,
    };
  });
  return { circuitKey, from: path, outline: tel.outline, segments };
}

/** Finds an archived session at the same circuit (this year first, then last year) and calibrates. */
export async function loadCalibration(circuitKey: number, exclude: string): Promise<Calibration | null> {
  const file = Bun.file(join(CALIBRATION_DIR, `${circuitKey}.json`));
  if (await file.exists()) return (await file.json()) as Calibration;
  const year = new Date().getUTCFullYear();
  for (const y of [year, year - 1]) {
    let idx: any;
    try {
      idx = await fetchJson(`${STATIC}${y}/Index.json`);
    } catch {
      continue;
    }
    const sessions = (idx.Meetings ?? [])
      .filter((m: any) => m.Circuit?.Key === circuitKey)
      .flatMap((m: any) => m.Sessions ?? [])
      .filter((s: any) => s.Path && s.Path !== exclude)
      .sort((a: any, b: any) => b.StartDate.localeCompare(a.StartDate));
    for (const s of sessions) {
      const cal = await calibrateFrom(s.Path, circuitKey).catch(() => null);
      if (cal) {
        await Bun.write(file, JSON.stringify(cal));
        return cal;
      }
    }
  }
  return null;
}

interface CarState {
  idx: number; // lap-order index of the last completed mini-sector
  t: number; // when it was completed
  pace: number; // last segment's actual/expected time
}

/** Estimates car positions from mini-sector completions. Times are ms on any monotonic clock. */
export class LiveMap {
  private line: Polyline;
  private index = new Map<string, number>();
  private cars = new Map<string, CarState>();

  constructor(readonly cal: Calibration) {
    this.line = new Polyline(cal.outline.points);
    cal.segments.forEach((s, i) => this.index.set(s.key, i));
  }

  onTiming(delta: unknown, t: number) {
    for (const [num, key, status] of segmentUpdates(delta)) {
      const i = this.index.get(key);
      if (i == null || status === PIT) continue;
      const prev = this.cars.get(num);
      if (prev && prev.idx === i && t - prev.t < 20_000) continue; // a status re-send, not a crossing
      let pace = prev?.pace ?? 1;
      const n = this.cal.segments.length;
      if (prev && (prev.idx + 1) % n === i) {
        pace = Math.max(0.6, Math.min(4, (t - prev.t) / this.cal.segments[i]!.ms));
      }
      this.cars.set(num, { idx: i, t, pace });
    }
  }

  /** Initial placement from a keyframe: each car at its furthest completed mini-sector this lap. */
  seed(lines: Record<string, any>, t: number) {
    for (const [num, line] of Object.entries(lines ?? {})) {
      if (this.cars.has(num)) continue;
      let best = -1;
      (Array.isArray(line?.Sectors) ? line.Sectors : Object.values(line?.Sectors ?? {})).forEach((sec: any, si: number) => {
        const segs = Array.isArray(sec?.Segments) ? sec.Segments : Object.values(sec?.Segments ?? {});
        segs.forEach((sg: any, ki: number) => {
          const i = this.index.get(`${si}.${ki}`);
          if (i != null && sg?.Status && sg.Status !== PIT && i > best) best = i;
        });
      });
      if (best >= 0) this.cars.set(num, { idx: best, t, pace: 1 });
    }
  }

  /**
   * Positions at time `t`: {num: [x, y, flag]} with flag 1 on track, 0 stale/stopped, 2 in pit.
   * `lines` is the merged TimingData.Lines (for InPit / Retired / Stopped).
   */
  positionsAt(t: number, lines: Record<string, any>): Record<string, [number, number, number]> {
    const out: Record<string, [number, number, number]> = {};
    const segs = this.cal.segments;
    const n = segs.length;
    for (const [num, line] of Object.entries(lines ?? {})) {
      const car = this.cars.get(num);
      if (line?.InPit) {
        const [x, y] = this.line.pointAt(segs[n - 1]!.at); // parked at the start/finish line in the pit box
        out[num] = [x, y, 2];
        continue;
      }
      if (!car) continue;
      const next = segs[(car.idx + 1) % n]!;
      const from = segs[car.idx]!.at;
      let span = next.at - from;
      if (span <= 0) span += this.line.length;
      const expected = next.ms * car.pace;
      const elapsed = t - car.t;
      // Stop just short of the next boundary until its completion arrives.
      const progress = Math.min(0.97, Math.max(0, elapsed / expected));
      const [x, y] = this.line.pointAt(from + progress * span);
      const stale = line?.Retired || line?.Stopped || elapsed > Math.max(30_000, expected * 4);
      out[num] = [x, y, stale ? 0 : 1];
    }
    return out;
  }
}

function push(m: Map<string, number[]>, k: string, v: number) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** Median on a loop: unwrap around the most common side of the start line first. */
function circularMedian(v: number[], length: number): number {
  const ref = median(v);
  const unwrapped = v.map((s) => (s - ref > length / 2 ? s - length : ref - s > length / 2 ? s + length : s));
  return ((median(unwrapped) % length) + length) % length;
}

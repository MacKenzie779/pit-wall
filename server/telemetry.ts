// Car position and telemetry from the archive's Position.z / CarData.z feeds (auth-gated live,
// free in the static archive). Builds replay events, a per-car lap index, the track outline
// and per-lap telemetry traces.

import { inflateRawSync } from "node:zlib";
import { merge } from "../shared/merge.ts";
import type { LapInfo, LapTrace, TrackOutline } from "../shared/types.ts";
import type { ReplayEvent } from "./replay.ts";

// CarData channel ids
const RPM = "0";
const SPEED = "2";
const GEAR = "3";
const THROTTLE = "4";
const BRAKE = "5";

export function decodeZ(data: unknown): any {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(inflateRawSync(Buffer.from(data, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

/** Columnar per-car samples, sorted by t (stream ms). */
interface PosTrack {
  t: Float64Array;
  x: Float32Array;
  y: Float32Array;
  on: Uint8Array;
}
interface CarTrack {
  t: Float64Array;
  rpm: Uint16Array;
  speed: Uint16Array;
  gear: Uint8Array;
  throttle: Uint8Array;
  brake: Uint8Array;
}

export class SessionTelemetry {
  readonly pos = new Map<string, PosTrack>();
  readonly car = new Map<string, CarTrack>();
  readonly laps = new Map<string, LapInfo[]>();
  outline: TrackOutline | null = null;

  /** Decodes raw .z lines; samples are timed by their own UTC. Samples before `from` (stream ms) are dropped. */
  ingest(posLines: ReplayEvent[], carLines: ReplayEvent[], startUtc: number, from: number) {
    const pos = new Map<string, number[][]>();
    for (const line of posLines) {
      for (const s of decodeZ(line.data)?.Position ?? []) {
        const t = Date.parse(s.Timestamp) - startUtc;
        if (!(t >= from)) continue;
        for (const [num, e] of Object.entries<any>(s.Entries ?? {}))
          push(pos, num, [t, e.X, e.Y, e.Status === "OnTrack" ? 1 : 0]);
      }
    }
    for (const [num, rows] of pos) {
      rows.sort((a, b) => a[0]! - b[0]!);
      this.pos.set(num, {
        t: Float64Array.from(rows, (r) => r[0]!),
        x: Float32Array.from(rows, (r) => r[1]!),
        y: Float32Array.from(rows, (r) => r[2]!),
        on: Uint8Array.from(rows, (r) => r[3]!),
      });
    }

    const car = new Map<string, number[][]>();
    for (const line of carLines) {
      for (const s of decodeZ(line.data)?.Entries ?? []) {
        const t = Date.parse(s.Utc) - startUtc;
        if (!(t >= from)) continue;
        for (const [num, c] of Object.entries<any>(s.Cars ?? {})) {
          const ch = c.Channels ?? {};
          push(car, num, [t, ch[RPM] ?? 0, ch[SPEED] ?? 0, ch[GEAR] ?? 0, ch[THROTTLE] ?? 0, ch[BRAKE] ?? 0]);
        }
      }
    }
    for (const [num, rows] of car) {
      rows.sort((a, b) => a[0]! - b[0]!);
      this.car.set(num, {
        t: Float64Array.from(rows, (r) => r[0]!),
        rpm: Uint16Array.from(rows, (r) => r[1]!),
        speed: Uint16Array.from(rows, (r) => r[2]!),
        gear: Uint8Array.from(rows, (r) => r[3]!),
        throttle: Uint8Array.from(rows, (r) => Math.min(255, Math.max(0, r[4]!))),
        brake: Uint8Array.from(rows, (r) => (r[5]! ? 1 : 0)),
      });
    }
  }

  /** Car positions at `t`, linearly interpolated between samples: {num: [x, y, onTrack]}. */
  positionsAt(t: number): Record<string, [number, number, number]> {
    const out: Record<string, [number, number, number]> = {};
    for (const [num, p] of this.pos) {
      const i = upperBound(p.t, t);
      if (i === 0) continue;
      const a = i - 1;
      if (t - p.t[a]! > 10_000) {
        out[num] = [Math.round(p.x[a]!), Math.round(p.y[a]!), 0];
        continue;
      }
      const b = Math.min(i, p.t.length - 1);
      const span = p.t[b]! - p.t[a]!;
      const f = span > 0 && span < 2_000 ? Math.min(1, (t - p.t[a]!) / span) : 0;
      out[num] = [
        Math.round(p.x[a]! + (p.x[b]! - p.x[a]!) * f),
        Math.round(p.y[a]! + (p.y[b]! - p.y[a]!) * f),
        p.on[a]!,
      ];
    }
    return out;
  }

  /** Latest telemetry sample at `t`: {num: [rpm, speed, gear, throttle, brake]}. */
  carAt(t: number): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [num, c] of this.car) {
      const i = upperBound(c.t, t) - 1;
      if (i < 0 || t - c.t[i]! > 10_000) continue;
      out[num] = [c.rpm[i]!, c.speed[i]!, c.gear[i]!, c.throttle[i]!, c.brake[i]!];
    }
    return out;
  }

  /** Lap index from TimingData: a lap ends when a new LastLapTime is published. */
  indexLaps(timing: ReplayEvent[]) {
    let state: any;
    for (const e of timing) {
      state = merge(state, e.data);
      for (const [num, d] of Object.entries<any>((e.data as any)?.Lines ?? {})) {
        const value = d?.LastLapTime?.Value;
        if (!value) continue;
        const time = lapSeconds(value);
        const lap = state.Lines?.[num]?.NumberOfLaps;
        if (!time || !lap) continue;
        const list = this.laps.get(num) ?? [];
        if (list.at(-1)?.lap === lap) list.pop();
        list.push({ lap, time, end: e.t });
        this.laps.set(num, list);
      }
    }
  }

  /** Outline = the session's fastest lap, traced from that car's positions. */
  buildOutline() {
    let best: { num: string; lap: LapInfo } | null = null;
    for (const [num, laps] of this.laps)
      for (const lap of laps) if (!best || lap.time < best.lap.time) best = { num, lap };
    let pts: [number, number][] = [];
    if (best) {
      const from = best.lap.end - best.lap.time * 1000;
      const p = this.pos.get(best.num);
      if (p) for (let i = 0; i < p.t.length; i++) if (p.t[i]! >= from && p.t[i]! <= best.lap.end) pts.push([p.x[i]!, p.y[i]!]);
    }
    if (pts.length < 50) {
      // No timed lap: use the first on-track samples of the car with the most data.
      pts = [];
      const p = [...this.pos.values()].sort((a, b) => b.t.length - a.t.length)[0];
      if (p) for (let i = 0; i < p.t.length && pts.length < 600; i++) if (p.on[i]) pts.push([p.x[i]!, p.y[i]!]);
    }
    if (pts.length < 10) return;
    this.outline = { points: pts, rotation: principalAngle(pts) };
  }

  lapsUntil(num: string, cursor: number): LapInfo[] {
    return (this.laps.get(num) ?? []).filter((l) => l.end <= cursor);
  }

  trace(num: string, lapNo: number, cursor: number): LapTrace | null {
    const lap = this.laps.get(num)?.find((l) => l.lap === lapNo);
    if (!lap || lap.end > cursor) return null;
    const from = lap.end - lap.time * 1000;
    const c = this.car.get(num);
    if (!c) return null;
    let dist = 0;
    let prevT = from;
    const points: LapTrace["points"] = [];
    let i0 = upperBound(c.t, from);
    if (i0 > 0 && c.t[i0 - 1] === from) i0--; // include a sample exactly at the lap start
    for (let i = i0; i < c.t.length && c.t[i]! <= lap.end; i++) {
      dist += ((c.speed[i]! / 3.6) * (c.t[i]! - prevT)) / 1000;
      prevT = c.t[i]!;
      points.push({
        t: (c.t[i]! - from) / 1000,
        d: dist,
        speed: c.speed[i]!,
        throttle: c.throttle[i]!,
        brake: c.brake[i]! ? 100 : 0,
        gear: c.gear[i]!,
        rpm: c.rpm[i]!,
      });
    }
    return { num, lap: lap.lap, time: lap.time, points };
  }
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** First index with arr[i] > v. */
function upperBound(arr: Float64Array, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lapSeconds(v: string): number {
  const parts = v.split(":");
  const s = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
  return Number.isFinite(s) ? s : 0;
}

/** Angle (radians) of the outline's main axis, so the map can be laid out landscape. */
function principalAngle(pts: [number, number][]): number {
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

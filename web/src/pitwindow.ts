import type { Row } from "./derive.ts";
import { lapSeconds } from "./format.ts";

/** "+12.345" → 12.345; "1 L", "LAP 31", "" → null */
function gapSeconds(v: string): number | null {
  if (!v || /L/.test(v)) return null;
  const n = Number(v.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Race time behind the leader for every running car, in seconds. Lapped cars only show
 * "1 L" as their gap, so their time is chained from the car ahead plus the interval.
 */
export function raceTimes(rows: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  let prev: number | null = null;
  for (const r of rows) {
    if (r.retired || r.status === "STOP") continue;
    let t = r.line === 1 ? 0 : gapSeconds(r.gap);
    if (t == null && prev != null) {
      const iv = gapSeconds(r.interval);
      if (iv != null) t = prev + iv;
    }
    prev = t;
    if (t != null) out.set(r.num, t);
  }
  return out;
}

/** Current lap time: median of the last laps of cars on a normal lap (not in/out of the pits). */
export function referenceLap(rows: Row[]): number | null {
  const laps = rows
    .filter((r) => !r.retired && !r.status && (r.laps ?? 0) > 1)
    .map((r) => lapSeconds(r.last.Value))
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (laps.length < 3) return null;
  const mid = laps.length >> 1;
  return laps.length % 2 ? laps[mid]! : (laps[mid - 1]! + laps[mid]!) / 2;
}

export interface Neighbour {
  num: string;
  gap: number; // on-track seconds to this car, always positive
  lapped: boolean; // a lap apart in the race: a backmarker in front, or a car about to lap you behind
}

export interface Rejoin {
  t: number; // race time behind the leader after the stop
  pos: number;
  ahead: Neighbour | null; // nearest car on the road in front
  behind: Neighbour | null;
}

/** Where `num` would come out if it pitted now and lost `loss` seconds; others stay out. */
export function rejoin(times: Map<string, number>, num: string, loss: number, lap: number): Rejoin | null {
  const own = times.get(num);
  if (own == null || !(lap > 0)) return null;
  const t = own + loss;
  let pos = 1;
  let ahead: Neighbour | null = null;
  let behind: Neighbour | null = null;
  for (const [n, u] of times) {
    if (n === num) continue;
    if (u < t) pos++;
    // On the circle a car is "ahead" by however far round it is, wrapping each lap.
    const inFront = mod(t - u, lap);
    const behindBy = mod(u - t, lap);
    if (!ahead || inFront < ahead.gap) ahead = { num: n, gap: inFront, lapped: u > t };
    if (!behind || behindBy < behind.gap) behind = { num: n, gap: behindBy, lapped: u < t };
  }
  return { t, pos, ahead, behind };
}

export const mod = (a: number, n: number) => ((a % n) + n) % n;

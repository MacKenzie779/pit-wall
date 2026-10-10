import { expect, test } from "bun:test";
import type { TimingLine } from "../shared/types.ts";
import { projectLap } from "../web/src/derive.ts";

const line = (s1: string, s2: string, s3: string, extra: Partial<TimingLine> = {}): TimingLine => ({
  Line: 1,
  RacingNumber: "63",
  Sectors: [{ Value: s1 }, { Value: s2 }, { Value: s3 }],
  ...extra,
});
const pb = [28.0, 40.0, 26.5];

test("one sector done: actual S1 + best S2 + best S3", () => {
  expect(projectLap(line("27.900", "", ""), pb)).toEqual({ time: 27.9 + 40 + 26.5, done: 1, estimated: false });
});

test("two sectors done", () => {
  const p = projectLap(line("27.900", "39.800", ""), pb)!;
  expect(p.done).toBe(2);
  expect(p.time).toBeCloseTo(27.9 + 39.8 + 26.5, 6);
});

test("no projection on a completed lap or before S1", () => {
  expect(projectLap(line("27.900", "39.800", "26.400"), pb)).toBeNull();
  expect(projectLap(line("", "", ""), pb)).toBeNull();
});

test("out laps / cool-down laps (sector >8% off the best) are not projected", () => {
  expect(projectLap(line("40.082", "", ""), pb)).toBeNull();
});

test("needs personal bests for every sector, and a car on track", () => {
  expect(projectLap(line("27.900", "", ""), [28, undefined, 26.5])).toBeNull();
  expect(projectLap(line("27.900", "", "", { InPit: true }), pb)).toBeNull();
});

test("a personal best from a slow lap is replaced by the session best at this lap's pace", () => {
  // Own S3 "best" (35.0) is an out-lap time; session best S3 is 26.0. This lap is 1% off session pace.
  const p = projectLap(line("28.280", "", ""), [28.28, 40.4, 35.0], [28.0, 40.0, 26.0])!;
  expect(p.estimated).toBe(true);
  expect(p.time).toBeCloseTo(28.28 + 40.4 + 26.0 * 1.01, 3);
});

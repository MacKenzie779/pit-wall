import { expect, test } from "bun:test";
import { LiveMap, type Calibration, segmentUpdates } from "../server/livemap.ts";

// A 400 m square track (units of 1/10 m) with one mini-sector per side, 10 s each.
const points: [number, number][] = [];
for (let i = 0; i < 1000; i++) points.push([i, 0]);
for (let i = 0; i < 1000; i++) points.push([1000, i]);
for (let i = 0; i < 1000; i++) points.push([1000 - i, 1000]);
for (let i = 0; i < 1000; i++) points.push([0, 1000 - i]);
const cal: Calibration = {
  circuitKey: 1,
  from: "test",
  outline: { points, rotation: 0 },
  segments: [
    { key: "0.0", at: 1000, ms: 10_000 },
    { key: "0.1", at: 2000, ms: 10_000 },
    { key: "1.0", at: 3000, ms: 10_000 },
    { key: "1.1", at: 3999, ms: 10_000 },
  ],
};
const crossing = (key: string) => {
  const [s, k] = key.split(".");
  return { Lines: { "16": { Sectors: { [s!]: { Segments: { [k!]: { Status: 2049 } } } } } } };
};
const lines = { "16": { Line: 1 } };

test("segment updates are extracted from timing deltas", () => {
  expect(segmentUpdates(crossing("1.1"))).toEqual([["16", "1.1", 2049]]);
});

test("a crossing snaps the car to the boundary and it moves on at expected pace", () => {
  const map = new LiveMap(cal);
  map.onTiming(crossing("0.0"), 0);
  expect(map.positionsAt(0, lines)["16"]).toEqual([1000, 0, 1]);
  expect(map.positionsAt(5_000, lines)["16"]).toEqual([1000, 500, 1]); // halfway along side 2
});

test("the car waits short of the next boundary until it is reported", () => {
  const map = new LiveMap(cal);
  map.onTiming(crossing("0.0"), 0);
  const [x, y] = map.positionsAt(25_000, lines)["16"]!;
  expect(x).toBe(1000);
  expect(y).toBe(970); // capped at 97 % of the segment
});

test("pace adapts to the car's last segment time", () => {
  const map = new LiveMap(cal);
  map.onTiming(crossing("0.0"), 0);
  map.onTiming(crossing("0.1"), 20_000); // took twice the reference
  expect(map.positionsAt(30_000, lines)["16"]).toEqual([500, 1000, 1]); // 10 s into a 20 s segment
});

test("cars in the pit lane are flagged, not placed on track", () => {
  const map = new LiveMap(cal);
  expect(map.positionsAt(0, { "16": { InPit: true } })["16"]![2]).toBe(2);
});

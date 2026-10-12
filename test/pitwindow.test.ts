import { expect, test } from "bun:test";
import type { Row } from "../web/src/derive.ts";
import { raceTimes, referenceLap, rejoin } from "../web/src/pitwindow.ts";

const row = (num: string, line: number, gap: string, interval: string, extra: Partial<Row> = {}): Row =>
  ({ num, line, gap, interval, status: "", retired: false, laps: 20, last: { Value: "1:30.000" }, ...extra }) as Row;

test("lapped cars chain the interval onto the car ahead", () => {
  const rows = [
    row("1", 1, "LAP 20", "LAP 20"),
    row("2", 2, "+10.000", "+10.000"),
    row("3", 3, "1 L", "+85.500"),
    row("4", 4, "1 L", "+2.000"),
    row("5", 5, "", "", { retired: true }),
  ];
  expect([...raceTimes(rows)]).toEqual([
    ["1", 0],
    ["2", 10],
    ["3", 95.5],
    ["4", 97.5],
  ]);
});

test("an unknown gap breaks the chain instead of guessing", () => {
  const times = raceTimes([row("1", 1, "LAP 3", ""), row("2", 2, "1 L", "2L"), row("3", 3, "1 L", "+1.000")]);
  expect([...times.keys()]).toEqual(["1"]);
});

test("reference lap is the median of normal laps", () => {
  const rows = [
    row("1", 1, "", "", { last: { Value: "1:30.000" } }),
    row("2", 2, "", "", { last: { Value: "1:31.000" } }),
    row("3", 3, "", "", { last: { Value: "1:50.000" }, status: "OUT" }),
    row("4", 4, "", "", { last: { Value: "1:32.000" } }),
  ];
  expect(referenceLap(rows)).toBe(91);
  expect(referenceLap(rows.slice(0, 2))).toBeNull();
});

test("rejoin position and nearest cars on the road, wrapping round the lap", () => {
  const times = new Map([
    ["1", 0],
    ["2", 5],
    ["3", 20],
    ["4", 26],
    ["9", 98], // a lap down: 8s behind the leader on the road
  ]);
  const r = rejoin(times, "1", 22, 90)!;
  expect(r.t).toBe(22);
  expect(r.pos).toBe(3); // behind 2 and 3
  expect(r.ahead).toEqual({ num: "3", gap: 2, lapped: false });
  expect(r.behind).toEqual({ num: "4", gap: 4, lapped: false });

  // Losing 10s puts the leader 2s behind the lapped car 9 on the road, still leading.
  const l = rejoin(new Map([["1", 0], ["9", 98]]), "1", 10, 90)!;
  expect(l.ahead).toEqual({ num: "9", gap: 2, lapped: true });
  expect(l.pos).toBe(1);
});

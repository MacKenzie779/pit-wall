import { describe, expect, test } from "bun:test";
import { applyDelta, merge, toList } from "../shared/merge.ts";

describe("merge", () => {
  test("deep-merges objects and keeps untouched references", () => {
    const a = { Lines: { "1": { Gap: "+1" }, "44": { Gap: "+2" } } };
    const b = merge(a, { Lines: { "1": { Gap: "+3" } } }) as any;
    expect(b.Lines["1"].Gap).toBe("+3");
    expect(b.Lines["44"]).toBe(a.Lines["44"]);
    expect(a.Lines["1"].Gap).toBe("+1");
  });

  test("index-keyed object updates and appends into arrays", () => {
    const a = { Stints: [{ Compound: "SOFT", TotalLaps: 3 }] };
    const b = merge(a, { Stints: { "0": { TotalLaps: 4 }, "1": { Compound: "HARD" } } }) as any;
    expect(b.Stints).toEqual([{ Compound: "SOFT", TotalLaps: 4 }, { Compound: "HARD" }]);
  });

  test("index-keyed object on missing target stays an object (Lines are keyed by car number)", () => {
    const b = merge(undefined, { "1": { a: 1 }, "44": { a: 2 } }) as any;
    expect(Array.isArray(b)).toBe(false);
    expect(b["44"].a).toBe(2);
  });

  test("arrays in delta replace", () => {
    expect(merge({ x: [1, 2, 3] }, { x: [9] })).toEqual({ x: [9] });
  });

  test("_deleted removes keys", () => {
    const b = merge({ BestLapTime: { Value: "1:30.000", Lap: 5 } }, {
      BestLapTime: { Value: "", _deleted: ["Lap"] },
    });
    expect(b).toEqual({ BestLapTime: { Value: "" } });
  });

  test("nested sector segments via index keys", () => {
    const s = { Sectors: [{ Value: "", Segments: [{ Status: 0 }, { Status: 0 }] }] };
    const b = merge(s, { Sectors: { "0": { Segments: { "1": { Status: 2051 } } } } }) as any;
    expect(b.Sectors[0].Segments[1].Status).toBe(2051);
    expect(b.Sectors[0].Segments[0]).toBe(s.Sectors[0]!.Segments[0]);
  });

  test("applyDelta creates topic", () => {
    expect(applyDelta({}, "TrackStatus", { Status: "4" })).toEqual({ TrackStatus: { Status: "4" } });
  });

  test("toList handles arrays and index objects", () => {
    expect(toList([1, 2])).toEqual([1, 2]);
    expect(toList({ "1": "b", "0": "a" })).toEqual(["a", "b"]);
    expect(toList(undefined)).toEqual([]);
  });
});

describe("mergeTyreSets", () => {
  test("pit-lane passes without a tyre change extend the current set", async () => {
    const { mergeTyreSets } = await import("../web/src/derive.ts");
    // Singapore 2026 sprint: everyone led through the pits behind the SC three times.
    const raw = [
      { Compound: "INTERMEDIATE", New: "true", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 2 },
      { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "1", StartLaps: 2, TotalLaps: 3 },
      { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "1", StartLaps: 3, TotalLaps: 4 },
      { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "1", StartLaps: 4, TotalLaps: 20 },
    ];
    expect(mergeTyreSets(raw)).toEqual([
      { Compound: "INTERMEDIATE", New: "true", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 20 },
    ]);
  });

  test("real tyre changes stay separate", async () => {
    const { mergeTyreSets } = await import("../web/src/derive.ts");
    const raw = [
      { Compound: "MEDIUM", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 20 },
      { Compound: "HARD", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 15 },
    ];
    expect(mergeTyreSets(raw)).toHaveLength(2);
  });
});

test("mergeTyreSets: same used set continuing despite a later-flipped TyresNotChanged flag", async () => {
  const { mergeTyreSets } = await import("../web/src/derive.ts");
  // Leclerc, Singapore 2026 sprint: stint 1's flag was rewritten to "0" laps after the SC pass.
  const raw = [
    { Compound: "INTERMEDIATE", New: "true", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 2 },
    { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "0", StartLaps: 2, TotalLaps: 3 },
    { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "1", StartLaps: 3, TotalLaps: 4 },
    { Compound: "INTERMEDIATE", New: "false", TyresNotChanged: "1", StartLaps: 4, TotalLaps: 20 },
  ];
  expect(mergeTyreSets(raw)).toHaveLength(1);
});

test("mergeTyreSets: tyre age comes from whichever entry is still counting", async () => {
  const { mergeTyreSets } = await import("../web/src/derive.ts");
  // Live race, lap 12, no pit stop: F1 added a frozen "tyres not changed" entry at 6 laps
  // while the original stint kept counting.
  const raw = [
    { Compound: "MEDIUM", New: "true", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 12 },
    { Compound: "MEDIUM", New: "true", TyresNotChanged: "1", StartLaps: 0, TotalLaps: 6 },
  ];
  expect(mergeTyreSets(raw)).toEqual([{ Compound: "MEDIUM", New: "true", TyresNotChanged: "0", StartLaps: 0, TotalLaps: 12 }]);
});

import { describe, expect, test } from "bun:test";
import type { Standings } from "../shared/types.ts";
import type { Row } from "../web/src/derive.ts";
import { buildStandings } from "../web/src/standings.ts";

const base: Standings = {
  season: 2026,
  after: { meeting: "Test GP", session: "Race", path: "x/" },
  drivers: [
    { num: "12", tla: "ANT", name: "", team: "Mercedes", color: "#0", points: 100, pos: 1 },
    { num: "16", tla: "LEC", name: "", team: "Ferrari", color: "#0", points: 90, pos: 2 },
    { num: "44", tla: "HAM", name: "", team: "Ferrari", color: "#0", points: 80, pos: 3 },
  ],
  teams: [
    { name: "Ferrari", color: "#0", points: 170, pos: 1 },
    { name: "Mercedes", color: "#0", points: 100, pos: 2 },
  ],
};

const row = (num: string, line: number, retired = false) => ({ num, line, retired }) as Row;

const feed = (name: string) => ({
  SessionInfo: { Type: "Race", Name: name, Path: "cur/" },
  DriverList: {
    "12": { RacingNumber: "12", Tla: "ANT", TeamName: "Mercedes" },
    "16": { RacingNumber: "16", Tla: "LEC", TeamName: "Ferrari" },
    "44": { RacingNumber: "44", Tla: "HAM", TeamName: "Ferrari" },
  },
});

describe("computed projection", () => {
  test("race points by running order, retirements score nothing", () => {
    const m = buildStandings(feed("Race"), [row("44", 1), row("16", 2), row("12", 3, true)], base, true)!;
    expect(m.mode).toBe("computed");
    expect(m.drivers.map((d) => [d.label, d.projected, d.pos])).toEqual([
      ["LEC", 108, 1],
      ["HAM", 105, 2],
      ["ANT", 100, 3],
    ]);
    expect(m.teams.find((t) => t.label === "Ferrari")!.projected).toBe(170 + 25 + 18);
  });

  test("sprint uses sprint points", () => {
    const m = buildStandings(feed("Sprint"), [row("12", 1), row("16", 2), row("44", 3)], base, true)!;
    expect(m.drivers.map((d) => d.gain)).toEqual([8, 7, 6]);
  });

  test("non-race sessions show plain standings", () => {
    const f = { ...feed("Race"), SessionInfo: { Type: "Qualifying", Name: "Qualifying" } };
    expect(buildStandings(f, [row("12", 1)], base, true)!.mode).toBe("static");
  });
});

test("official ChampionshipPrediction takes precedence", () => {
  const f = {
    ...feed("Race"),
    ChampionshipPrediction: {
      Drivers: {
        "12": { RacingNumber: "12", CurrentPosition: 1, PredictedPosition: 2, CurrentPoints: 100, PredictedPoints: 101 },
        "16": { RacingNumber: "16", CurrentPosition: 2, PredictedPosition: 1, CurrentPoints: 90, PredictedPoints: 115 },
      },
      Teams: {},
    },
  };
  const m = buildStandings(f, [], base, true)!;
  expect(m.mode).toBe("official");
  expect(m.drivers[0]).toMatchObject({ label: "LEC", pos: 1, basePos: 2, gain: 25 });
});

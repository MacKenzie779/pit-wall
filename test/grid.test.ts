import { expect, test } from "bun:test";
import { gridAtStart } from "../server/hub.ts";
import fixture from "./fixtures/start-order.json";

// Synthetic start order. In a real feed, F1's LapSeries/GridPos once put car 1 on P1 when it started P5.
const state = (status: string) => ({
  SessionInfo: { Type: "Race" },
  SessionStatus: { Status: status },
  TimingData: { Lines: Object.fromEntries(Object.entries(fixture.lines).map(([n, line]) => [n, { Line: line }])) },
});

test("the grid is the running order when the race goes green", () => {
  const grid = gridAtStart(state("Started"))!;
  expect(grid["1"]).toBe(5);
  expect(grid["3"]).toBe(1);
  expect(new Set(Object.values(grid)).size).toBe(Object.keys(grid).length);
});

test("no grid before the start or outside races", () => {
  expect(gridAtStart(state("Inactive"))).toBeNull();
  expect(gridAtStart({ ...state("Started"), SessionInfo: { Type: "Qualifying" } })).toBeNull();
});

import { expect, test } from "bun:test";
import { flagState } from "../web/src/flags.ts";

const msg = (Flag: string, Scope: string, Sector?: number) => ({ Utc: "", Category: "Flag", Flag, Scope, Sector, Message: "" });

test("sector yellows are set, upgraded and cleared per sector", () => {
  const m = [msg("YELLOW", "Sector", 10), msg("YELLOW", "Sector", 11), msg("DOUBLE YELLOW", "Sector", 10), msg("CLEAR", "Sector", 11)];
  const s = flagState(m, "2");
  expect([...s.sectors]).toEqual([[10, "DOUBLE YELLOW"]]);
  expect(s.red).toBe(false);
});

test("track-wide green clears all sectors; TrackStatus all-clear is a safety net", () => {
  expect(flagState([msg("YELLOW", "Sector", 3), msg("GREEN", "Track")], "2").sectors.size).toBe(0);
  expect(flagState([msg("YELLOW", "Sector", 3)], "1").sectors.size).toBe(0);
});

test("red flag follows TrackStatus", () => {
  expect(flagState([msg("RED", "Track")], "5").red).toBe(true);
  expect(flagState([msg("RED", "Track")], "1").red).toBe(false);
});

test("non-flag messages are ignored", () => {
  expect(flagState([{ Utc: "", Category: "Other", Message: "TRACK SURFACE SLIPPERY IN TRACK SECTOR 13" }], "2").sectors.size).toBe(0);
});

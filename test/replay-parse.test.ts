import { expect, test } from "bun:test";
import { merge } from "../shared/merge.ts";
import { mergeTimelines, parseJsonStream } from "../server/replay.ts";

const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

test("parses BOM-prefixed jsonStream lines into timed events", async () => {
  const ev = parseJsonStream("TrackStatus", await fixture("TrackStatus.jsonStream"));
  expect(ev.length).toBe(3);
  expect(ev[0]).toEqual({ t: 0, topic: "TrackStatus", data: { Status: "1", Message: "AllClear" } });
  expect(ev[1]!.t).toBe(16 * 60_000 + 34_309);
});

test("ignores non-stream content such as S3 error XML", () => {
  expect(parseJsonStream("X", '<?xml version="1.0"?><Error/>')).toEqual([]);
});

test("replaying a stint stream accumulates stints", async () => {
  const ev = parseJsonStream("TimingAppData", await fixture("TimingAppData.jsonStream"));
  const state = ev.reduce<any>((s, e) => merge(s, e.data), undefined);
  const stints = state.Lines["3"].Stints;
  expect(stints.length).toBe(2);
  expect(stints[0].Compound).toBe("INTERMEDIATE");
});

test("timelines merge in time order", () => {
  const a = [{ t: 0, topic: "A", data: 1 }, { t: 20, topic: "A", data: 2 }];
  const b = [{ t: 10, topic: "B", data: 3 }];
  expect(mergeTimelines([a, b]).map((e) => e.t)).toEqual([0, 10, 20]);
});

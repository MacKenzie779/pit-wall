import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { SessionTelemetry } from "../server/telemetry.ts";

const z = (obj: unknown) => deflateRawSync(Buffer.from(JSON.stringify(obj))).toString("base64");
const START = Date.parse("2026-10-10T09:00:00Z");
const iso = (ms: number) => new Date(START + ms).toISOString();

function build() {
  const tel = new SessionTelemetry();
  const pos = [
    {
      t: 0,
      topic: "Position.z",
      data: z({
        Position: [
          { Timestamp: iso(1000), Entries: { "16": { Status: "OnTrack", X: 0, Y: 0 } } },
          { Timestamp: iso(2000), Entries: { "16": { Status: "OnTrack", X: 100, Y: -50 } } },
        ],
      }),
    },
  ];
  // 10 s lap at a constant 180 km/h (50 m/s), samples every second.
  const car = [
    {
      t: 0,
      topic: "CarData.z",
      data: z({
        Entries: Array.from({ length: 12 }, (_, i) => ({
          Utc: iso(i * 1000),
          Cars: { "16": { Channels: { "0": 11000, "2": 180, "3": 7, "4": 100, "5": 0 } } },
        })),
      }),
    },
  ];
  tel.ingest(pos, car, START, 0);
  tel.indexLaps([
    { t: 1000, topic: "TimingData", data: { Lines: { "16": { NumberOfLaps: 1 } } } },
    { t: 11000, topic: "TimingData", data: { Lines: { "16": { NumberOfLaps: 2, LastLapTime: { Value: "10.000" } } } } },
  ]);
  return tel;
}

describe("SessionTelemetry", () => {
  test("interpolates positions between samples", () => {
    expect(build().positionsAt(1500)["16"]).toEqual([50, -25, 1]);
  });

  test("car data is the latest sample", () => {
    expect(build().carAt(4500)["16"]).toEqual([11000, 180, 7, 100, 0]);
  });

  test("laps are indexed from LastLapTime and hidden until reached", () => {
    const tel = build();
    expect(tel.lapsUntil("16", 10_999)).toEqual([]);
    expect(tel.lapsUntil("16", 11_000)).toEqual([{ lap: 2, time: 10, end: 11000 }]);
  });

  test("lap trace integrates distance from speed", () => {
    const trace = build().trace("16", 2, 20_000)!;
    expect(trace.points.length).toBe(11);
    expect(Math.round(trace.points.at(-1)!.d)).toBe(500); // 10 s × 50 m/s
  });
});

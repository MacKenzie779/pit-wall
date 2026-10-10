import { useEffect, useState } from "react";
import type { FeedState } from "../../shared/merge.ts";
import type { ChampionshipPrediction, Driver, SessionInfo, Standings } from "../../shared/types.ts";
import type { Row } from "./derive.ts";
import { sessionKind } from "./derive.ts";

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export type StandingsMode =
  | "official" // F1's own live ChampionshipPrediction
  | "computed" // base standings + points for current running order
  | "static"; // standings after the last archived race/sprint

export interface StandRow {
  id: string;
  pos: number;
  basePos: number;
  label: string;
  sub: string;
  color: string;
  num?: string;
  points: number; // before this session
  gain: number;
  projected: number;
  racePos?: number;
  out?: boolean;
}

export interface StandingsModel {
  mode: StandingsMode;
  drivers: StandRow[];
  teams: StandRow[];
  baseLabel: string;
}

/** Fetches base standings; during a race session the session itself is excluded so it can be projected on top. */
export function useBaseStandings(excludePath: string) {
  const [data, setData] = useState<Standings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/standings?exclude=${encodeURIComponent(excludePath)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          if (d && "error" in d) setError(String(d.error));
          else {
            setData(d);
            setError("");
          }
        })
        .catch((e) => alive && setError(String(e)));
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [excludePath]);
  return { data, error };
}

/** Rank by points desc; ties keep the earlier (base) order. */
function rank(rows: StandRow[]): StandRow[] {
  const sorted = rows.slice().sort((a, b) => b.projected - a.projected || a.basePos - b.basePos);
  sorted.forEach((r, i) => (r.pos = i + 1));
  return sorted;
}

export function isRaceSession(feed: FeedState) {
  return sessionKind(feed.SessionInfo) === "race";
}

export function buildStandings(feed: FeedState, rows: Row[], base: Standings | null, live: boolean): StandingsModel | null {
  const info = feed.SessionInfo as SessionInfo | undefined;
  const race = isRaceSession(feed);
  const cp = feed.ChampionshipPrediction as ChampionshipPrediction | undefined;
  const dl = (feed.DriverList ?? {}) as Record<string, Driver>;
  const racePos = new Map(rows.map((r) => [r.num, r]));
  const baseDriver = new Map(base?.drivers.map((d) => [d.num, d]));
  const teamColor = new Map<string, string>();
  for (const d of Object.values(dl)) if (d?.TeamName && d.TeamColour) teamColor.set(d.TeamName, `#${d.TeamColour}`);
  for (const t of base?.teams ?? []) if (!teamColor.has(t.name)) teamColor.set(t.name, t.color);
  const baseLabel = base ? `${base.season} · after ${base.after.meeting} ${base.after.session}` : "";

  const driverMeta = (num: string) => {
    const d = dl[num];
    const b = baseDriver.get(num);
    return {
      label: d?.Tla ?? b?.tla ?? num,
      sub: d?.FullName ?? b?.name ?? "",
      color: d?.TeamColour ? `#${d.TeamColour}` : (b?.color ?? "#666666"),
    };
  };

  // 1. Official prediction from the feed (live races/sprints, and archived ones in replay).
  const cpDrivers = Object.values(cp?.Drivers ?? {}).filter((e) => e?.RacingNumber && e.CurrentPoints != null);
  if (race && cpDrivers.length) {
    const drivers = cpDrivers
      .map((e) => {
        const r = racePos.get(e.RacingNumber);
        return {
          id: e.RacingNumber,
          num: e.RacingNumber,
          ...driverMeta(e.RacingNumber),
          basePos: e.CurrentPosition ?? 99,
          pos: e.PredictedPosition ?? e.CurrentPosition ?? 99,
          points: e.CurrentPoints ?? 0,
          projected: e.PredictedPoints ?? e.CurrentPoints ?? 0,
          gain: (e.PredictedPoints ?? 0) - (e.CurrentPoints ?? 0),
          racePos: r?.line,
          out: r?.retired,
        };
      })
      .sort((a, b) => a.pos - b.pos);
    const teams = Object.values(cp?.Teams ?? {})
      .filter((t) => t?.TeamName)
      .map((t) => ({
        id: t.TeamName,
        label: t.TeamName,
        sub: "",
        color: teamColor.get(t.TeamName) ?? "#666666",
        basePos: t.CurrentPosition ?? 99,
        pos: t.PredictedPosition ?? t.CurrentPosition ?? 99,
        points: t.CurrentPoints ?? 0,
        projected: t.PredictedPoints ?? t.CurrentPoints ?? 0,
        gain: (t.PredictedPoints ?? 0) - (t.CurrentPoints ?? 0),
      }))
      .sort((a, b) => a.pos - b.pos);
    return { mode: "official", drivers, teams, baseLabel: "F1 championship prediction" };
  }

  if (!base) return null;

  // 2. Our own projection: base + points for the current running order.
  if (race && live && rows.length) {
    const table = (info?.Name ?? "").includes("Sprint") ? SPRINT_POINTS : RACE_POINTS;
    const gainFor = (r: Row | undefined) => (!r || r.retired ? 0 : (table[r.line - 1] ?? 0));
    const nums = new Set([...base.drivers.map((d) => d.num), ...rows.map((r) => r.num)]);
    const drivers = rank(
      [...nums].map((num) => {
        const b = baseDriver.get(num);
        const r = racePos.get(num);
        const gain = gainFor(r);
        return {
          id: num,
          num,
          ...driverMeta(num),
          basePos: b?.pos ?? 99,
          pos: 0,
          points: b?.points ?? 0,
          gain,
          projected: (b?.points ?? 0) + gain,
          racePos: r?.line,
          out: r?.retired,
        };
      }),
    );
    const teamGain = new Map<string, number>();
    for (const r of rows) {
      const team = dl[r.num]?.TeamName;
      if (team) teamGain.set(team, (teamGain.get(team) ?? 0) + gainFor(r));
    }
    const teamNames = new Set([...base.teams.map((t) => t.name), ...teamGain.keys()]);
    const teams = rank(
      [...teamNames].map((name) => {
        const b = base.teams.find((t) => t.name === name);
        const gain = teamGain.get(name) ?? 0;
        return {
          id: name,
          label: name,
          sub: "",
          color: teamColor.get(name) ?? "#666666",
          basePos: b?.pos ?? 99,
          pos: 0,
          points: b?.points ?? 0,
          gain,
          projected: (b?.points ?? 0) + gain,
        };
      }),
    );
    return { mode: "computed", drivers, teams, baseLabel };
  }

  // 3. Plain standings.
  const drivers = base.drivers.map((d) => ({
    id: d.num,
    num: d.num,
    label: d.tla,
    sub: d.name,
    color: d.color,
    basePos: d.pos,
    pos: d.pos,
    points: d.points,
    gain: 0,
    projected: d.points,
  }));
  const teams = base.teams.map((t) => ({
    id: t.name,
    label: t.name,
    sub: "",
    color: t.color,
    basePos: t.pos,
    pos: t.pos,
    points: t.points,
    gain: 0,
    projected: t.points,
  }));
  return { mode: "static", drivers, teams, baseLabel };
}

// Championship standings after the latest archived Race/Sprint, taken from the final state of
// that session's ChampionshipPrediction feed (same numbering and team names as the live feed).

import { merge } from "../shared/merge.ts";
import type { ChampionshipPrediction, Driver, Standings } from "../shared/types.ts";
import { fetchJson, parseJsonStream, STATIC } from "./replay.ts";

const TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; data: Standings | null }>();

async function finalState<T>(path: string, topic: string): Promise<T | undefined> {
  const res = await fetch(`${STATIC}${path}${topic}.jsonStream`);
  if (!res.ok) return undefined;
  return parseJsonStream(topic, await res.text()).reduce<unknown>((s, e) => merge(s, e.data), undefined) as T;
}

async function candidates(year: number) {
  const idx = await fetchJson(`${STATIC}${year}/Index.json`);
  return (idx.Meetings ?? [])
    .flatMap((m: any) =>
      (m.Sessions ?? [])
        .filter((s: any) => s.Path && s.Type === "Race")
        .map((s: any) => ({ meeting: m.Name as string, session: s.Name as string, path: s.Path as string, start: s.StartDate as string })),
    )
    .sort((a: any, b: any) => b.start.localeCompare(a.start));
}

async function build(year: number, exclude: string): Promise<Standings | null> {
  const list = (await candidates(year)).filter((c: any) => c.path !== exclude);
  for (const [i, c] of list.entries()) {
    const [cp, latest] = await Promise.all([
      finalState<ChampionshipPrediction>(c.path, "ChampionshipPrediction"),
      finalState<Record<string, Driver>>(c.path, "DriverList"),
    ]);
    if (!cp?.Drivers || !Object.keys(cp.Drivers).length) continue;

    // Drivers with points who didn't take part in this session: find them in earlier sessions.
    const drivers: Record<string, Driver> = { ...latest };
    for (const older of list.slice(i + 1, i + 12)) {
      const missing = Object.keys(cp.Drivers).filter((n) => !drivers[n]);
      if (!missing.length) break;
      const dl = await finalState<Record<string, Driver>>(older.path, "DriverList");
      for (const n of missing) if (dl?.[n]?.Tla) drivers[n] = dl[n]!;
    }

    const colorByTeam = new Map<string, string>();
    for (const d of Object.values(latest ?? {})) if (d?.TeamName && d.TeamColour) colorByTeam.set(d.TeamName, `#${d.TeamColour}`);

    return {
      season: year,
      after: { meeting: c.meeting, session: c.session, path: c.path },
      drivers: Object.values(cp.Drivers)
        .map((e) => {
          const d = drivers[e.RacingNumber];
          return {
            num: e.RacingNumber,
            tla: d?.Tla ?? e.RacingNumber,
            name: d?.FullName ?? "",
            team: d?.TeamName ?? "",
            color: d?.TeamColour ? `#${d.TeamColour}` : "#666666",
            points: e.PredictedPoints ?? e.CurrentPoints ?? 0,
            pos: e.PredictedPosition ?? e.CurrentPosition ?? 99,
          };
        })
        .sort((a, b) => a.pos - b.pos),
      teams: Object.values(cp.Teams ?? {})
        .map((t) => ({
          name: t.TeamName,
          color: colorByTeam.get(t.TeamName) ?? "#666666",
          points: t.PredictedPoints ?? t.CurrentPoints ?? 0,
          pos: t.PredictedPosition ?? t.CurrentPosition ?? 99,
        }))
        .sort((a, b) => a.pos - b.pos),
    };
  }
  return null;
}

/** `exclude` skips a session path (the one currently live/replayed) so it can be projected on top. */
export async function getStandings(exclude = ""): Promise<Standings | null> {
  const key = exclude;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const year = new Date().getUTCFullYear();
  const data = (await build(year, exclude)) ?? (await build(year - 1, exclude));
  cache.set(key, { at: Date.now(), data });
  return data;
}

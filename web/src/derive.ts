import { toList, type FeedState } from "../../shared/merge.ts";
import type {
  Driver,
  Sector,
  SessionInfo,
  Stint,
  TimedValue,
  TimingAppData,
  TimingData,
  TimingLine,
  TimingStats,
} from "../../shared/types.ts";
import { lapSeconds, parseHms } from "./format.ts";

export type SessionKind = "race" | "quali" | "practice";

export function sessionKind(info: SessionInfo | undefined): SessionKind {
  const t = info?.Type ?? "";
  if (t === "Race") return "race";
  if (t === "Qualifying") return "quali";
  return "practice";
}

export interface Row {
  num: string;
  tla: string;
  name: string;
  team: string;
  color: string;
  line: number;
  gridDelta: number | null; // positions gained vs grid (race only)
  gap: string;
  interval: string;
  catching: boolean;
  last: TimedValue;
  best: string;
  sectors: { value: string; stale: boolean; cls: string; segments: number[] }[];
  laps: number | undefined;
  pits: number; // stops where tyres were changed
  pitLanePasses: number; // F1's NumberOfPitStops: every trip through the pit lane
  tyre: { compound?: string; age?: number; isNew: boolean } | null;
  stints: Stint[];
  status: "" | "PIT" | "OUT" | "RET" | "STOP" | "KO";
  knockedOut: boolean;
  retired: boolean;
  /** Qualifying: completed sectors this lap + personal-best sectors for the rest. */
  projection: Projection | null;
}

export interface Projection {
  time: number;
  done: number; // sectors completed this lap (1 or 2)
  estimated: boolean; // a remaining sector used the scaled session best (no usable personal best)
  pos: number; // where it would rank in the current part
  delta: number | null; // vs the driver's best in this part
  cls: string; // c-purple: would be fastest overall; c-green: improves own best
  out: boolean; // would be in the elimination zone
}

/** Max slowdown vs a personal-best sector before a lap counts as not a push lap. */
const PUSH_MARGIN = 1.08;
/** A personal-best sector this far off the session best is from a slow lap, not a reference. */
const PB_PLAUSIBLE = 1.03;

/**
 * Projected lap from the sectors done so far on this lap: completed sectors + the driver's
 * personal-best sectors for the rest. Completing S1 clears S2/S3, so the lap in progress is
 * "S1 set, S2 empty" (1 done) or "S1+S2 set, S3 empty" (2 done).
 *
 * Early in a session a "personal best" sector is often from an out lap; when it is more than
 * 3% off the session best, the session best scaled by this lap's pace is used instead.
 */
export function projectLap(
  line: TimingLine,
  own: (number | undefined)[],
  overall: (number | undefined)[] = [],
): { time: number; done: number; estimated: boolean } | null {
  if (line.InPit || line.Retired || line.Stopped || line.KnockedOut) return null;
  const v = [0, 1, 2].map((i) => lapSeconds(toList(line.Sectors)[i]?.Value));
  const done = v[0]! > 0 && !(v[1]! > 0) ? 1 : v[0]! > 0 && v[1]! > 0 && !(v[2]! > 0) ? 2 : 0;
  if (!done) return null;

  let time = 0;
  let paceNum = 0;
  let paceDen = 0;
  for (let i = 0; i < done; i++) {
    const ref = own[i] ?? overall[i];
    if (!ref || v[i]! > ref * PUSH_MARGIN) return null; // out lap / cool-down lap
    time += v[i]!;
    if (overall[i]) {
      paceNum += v[i]!;
      paceDen += overall[i]!;
    }
  }
  const pace = paceDen ? paceNum / paceDen : 1;
  let estimated = false;
  for (let i = done; i < 3; i++) {
    const pb = own[i];
    const best = overall[i];
    if (pb && (!best || pb <= best * PB_PLAUSIBLE)) time += pb;
    else if (best) {
      time += best * pace;
      estimated = true;
    } else return null;
  }
  return { time, done, estimated };
}

function sameSet(prev: Stint, s: Stint): boolean {
  if (s.TyresNotChanged === "1") return true;
  // The flag is sometimes flipped to "0" later; a used set of the same compound whose
  // starting age equals the previous stint's final age is still the same tyres.
  return (
    s.New === "false" &&
    s.Compound === prev.Compound &&
    s.StartLaps != null &&
    s.StartLaps > 0 &&
    s.StartLaps === prev.TotalLaps
  );
}

/**
 * F1 opens a new stint on every pit-lane pass, including ones where the tyres stay on
 * (drive-throughs, all cars led through the pits behind the safety car). Fold those into
 * the previous stint so each entry is one set of tyres.
 */
export function mergeTyreSets(stints: Stint[]): Stint[] {
  const out: Stint[] = [];
  for (const s of stints) {
    const prev = out.at(-1);
    // Same set: its age is whichever entry F1 keeps counting up (usually the later one, but
    // sometimes the original stint while the extra entry stays frozen).
    if (prev && sameSet(prev, s))
      out[out.length - 1] = { ...prev, TotalLaps: Math.max(prev.TotalLaps ?? 0, s.TotalLaps ?? 0) };
    else out.push(s);
  }
  return out;
}

const sectorClass = (s: Sector | undefined) =>
  !s?.Value ? "" : s.OverallFastest ? "c-purple" : s.PersonalFastest ? "c-green" : "c-yellow";

export function deriveRows(feed: FeedState): { kind: SessionKind; rows: Row[]; cutoff: number | null; part: number } {
  const info = feed.SessionInfo as SessionInfo | undefined;
  const kind = sessionKind(info);
  const td = (feed.TimingData ?? {}) as TimingData;
  const app = (feed.TimingAppData ?? {}) as TimingAppData;
  const drivers = (feed.DriverList ?? {}) as Record<string, Driver>;
  const stats = (feed.TimingStats ?? {}) as TimingStats;
  const part = td.SessionPart ?? 0;
  const pi = Math.max(0, part - 1);
  // Best lap of each car in the current qualifying part, for projected positions.
  const partBests = new Map<string, number>();
  if (kind === "quali")
    for (const l of Object.values(td.Lines ?? {})) {
      const b = lapSeconds(toList(l?.BestLapTimes)[pi]?.Value);
      if (l?.RacingNumber && b > 0) partBests.set(l.RacingNumber, b);
    }
  const fastest = Math.min(...partBests.values());
  const sessionBestSectors = [0, 1, 2].map((i) => {
    const all = Object.values(stats.Lines ?? {})
      .map((l) => lapSeconds(toList(l?.BestSectors)[i]?.Value))
      .filter((x) => x > 0);
    return all.length ? Math.min(...all) : undefined;
  });

  const rows: Row[] = Object.values(td.Lines ?? {})
    .filter((l): l is TimingLine => !!l?.RacingNumber && typeof l.Line === "number")
    .map((l) => {
      const d = drivers[l.RacingNumber];
      const appLine = app.Lines?.[l.RacingNumber] as any;
      const stints = mergeTyreSets(toList<Stint>(appLine?.Stints).filter(Boolean));
      const cur = stints.at(-1);
      // Recorded at the start by the server; F1's GridPos can be wrong (see hub.recordGrid).
      const grid = Number(feed.StartingGrid?.[l.RacingNumber] ?? appLine?.GridPos);

      let gap = "";
      let interval = "";
      let best = l.BestLapTime?.Value ?? "";
      if (kind === "race") {
        gap = l.GapToLeader ?? "";
        interval = l.IntervalToPositionAhead?.Value ?? "";
      } else if (kind === "quali") {
        best = toList(l.BestLapTimes)[pi]?.Value || "";
        const st = toList(l.Stats)[pi];
        gap = st?.TimeDiffToFastest ?? "";
        interval = st?.TimeDifftoPositionAhead ?? "";
        // Knocked-out drivers keep their best from the part they were eliminated in.
        if (!best && l.KnockedOut) best = l.BestLapTime?.Value ?? "";
      } else {
        gap = l.TimeDiffToFastest ?? "";
        interval = l.TimeDiffToPositionAhead ?? "";
      }

      const sectors = [0, 1, 2].map((i) => {
        const s = toList(l.Sectors)[i];
        const stale = !s?.Value && !!s?.PreviousValue;
        return {
          value: s?.Value || s?.PreviousValue || "",
          stale,
          cls: stale ? "" : sectorClass(s),
          segments: toList(s?.Segments).map((x) => x?.Status ?? 0),
        };
      });

      let status: Row["status"] = "";
      if (l.Retired) status = "RET";
      else if (l.Stopped) status = "STOP";
      else if (l.InPit) status = "PIT";
      else if (l.PitOut) status = "OUT";
      else if (l.KnockedOut) status = "KO";

      return {
        num: l.RacingNumber,
        tla: d?.Tla ?? l.RacingNumber,
        name: d?.FullName ?? d?.BroadcastName ?? "",
        team: d?.TeamName ?? "",
        color: `#${d?.TeamColour || "666666"}`,
        line: l.Line,
        gridDelta: kind === "race" && grid > 0 ? grid - l.Line : null,
        gap,
        interval,
        catching: !!l.IntervalToPositionAhead?.Catching,
        last: l.LastLapTime ?? {},
        best,
        sectors,
        laps: l.NumberOfLaps,
        pits: Math.max(0, stints.length - 1),
        pitLanePasses: l.NumberOfPitStops ?? 0,
        tyre: cur ? { compound: cur.Compound, age: cur.TotalLaps, isNew: cur.New === "true" } : null,
        stints,
        status,
        knockedOut: !!l.KnockedOut,
        retired: !!l.Retired,
        projection: kind === "quali" ? projection(l) : null,
      };
    })
    .sort((a, b) => a.line - b.line);

  function projection(l: TimingLine): Projection | null {
    const best = toList(stats.Lines?.[l.RacingNumber]?.BestSectors).map((b) => lapSeconds(b?.Value) || undefined);
    const p = projectLap(l, best, sessionBestSectors);
    if (!p) return null;
    let pos = 1;
    for (const [num, b] of partBests) if (num !== l.RacingNumber && b < p.time) pos++;
    const own = partBests.get(l.RacingNumber);
    const cut = td.NoEntries?.[part];
    return {
      ...p,
      pos,
      delta: own ? p.time - own : null,
      cls: p.time < fastest ? "c-purple" : own == null || p.time < own ? "c-green" : "",
      out: !!cut && part < (td.NoEntries?.length ?? 0) && pos > cut,
    };
  }

  // Quali elimination line: NoEntries = [22, 16, 10] → in Q1 the drop zone starts after P16.
  let cutoff: number | null = null;
  if (kind === "quali" && td.NoEntries && part >= 1 && part < td.NoEntries.length) {
    cutoff = td.NoEntries[part] ?? null;
  }
  return { kind, rows, cutoff, part };
}

/** Remaining session time in seconds, extrapolated with the (possibly virtual) server clock. */
export function remainingSeconds(feed: FeedState, now: number): number | null {
  const c = feed.ExtrapolatedClock as { Utc?: string; Remaining?: string; Extrapolating?: boolean } | undefined;
  if (!c?.Remaining) return null;
  const rem = parseHms(c.Remaining);
  if (!c.Extrapolating || !c.Utc) return rem;
  return Math.max(0, rem - (now - Date.parse(c.Utc)) / 1000);
}

export type TrackState = { code: string; label: string; cls: string };

export function trackState(feed: FeedState): TrackState {
  const s = String(feed.TrackStatus?.Status ?? "");
  switch (s) {
    case "1":
      return { code: s, label: "GREEN", cls: "ts-green" };
    case "2":
      return { code: s, label: "YELLOW", cls: "ts-yellow" };
    case "4":
      return { code: s, label: "SAFETY CAR", cls: "ts-sc" };
    case "5":
      return { code: s, label: "RED FLAG", cls: "ts-red" };
    case "6":
      return { code: s, label: "VSC DEPLOYED", cls: "ts-sc" };
    case "7":
      return { code: s, label: "VSC ENDING", cls: "ts-sc" };
    default:
      return { code: s, label: "—", cls: "ts-none" };
  }
}

import type { FeedState } from "./merge.ts";

// ---------- Feed shapes (only the fields we use) ----------

type Indexed<T> = T[] | Record<string, T>;

export interface TimedValue {
  Value?: string;
  Status?: number;
  OverallFastest?: boolean;
  PersonalFastest?: boolean;
}

export interface Sector extends TimedValue {
  Stopped?: boolean;
  PreviousValue?: string;
  Segments?: Indexed<{ Status: number }>;
}

export interface TimingLine {
  Line: number;
  Position?: string;
  RacingNumber: string;
  GapToLeader?: string;
  IntervalToPositionAhead?: { Value?: string; Catching?: boolean };
  TimeDiffToFastest?: string;
  TimeDiffToPositionAhead?: string;
  NumberOfLaps?: number;
  NumberOfPitStops?: number;
  Retired?: boolean;
  InPit?: boolean;
  PitOut?: boolean;
  Stopped?: boolean;
  KnockedOut?: boolean;
  Cutoff?: boolean;
  BestLapTimes?: Indexed<{ Value?: string; Lap?: number }>;
  Stats?: Indexed<{ TimeDiffToFastest?: string; TimeDifftoPositionAhead?: string }>;
  Sectors?: Indexed<Sector>;
  Speeds?: Partial<Record<SpeedTrap, TimedValue>>;
  BestLapTime?: { Value?: string; Lap?: number };
  LastLapTime?: TimedValue;
}

export type SpeedTrap = "I1" | "I2" | "FL" | "ST";

export interface TimingData {
  Lines?: Record<string, TimingLine>;
  SessionPart?: number;
  NoEntries?: number[];
  Withheld?: boolean;
}

export interface Stint {
  Compound?: string;
  New?: string;
  TotalLaps?: number;
  StartLaps?: number;
  LapNumber?: number;
  TyresNotChanged?: string; // "1" = pit-lane pass on the same set (drive-through, SC through the pits)
}

export interface TimingAppData {
  Lines?: Record<string, { RacingNumber: string; Line?: number; Stints?: Indexed<Stint> }>;
}

export interface TimingStats {
  SessionType?: string;
  Lines?: Record<
    string,
    {
      PersonalBestLapTime?: { Value?: string; Position?: number };
      BestSectors?: Indexed<{ Value?: string; Position?: number }>;
      BestSpeeds?: Partial<Record<SpeedTrap, { Value?: string; Position?: number }>>;
    }
  >;
}

export interface Driver {
  RacingNumber: string;
  Tla: string;
  FullName?: string;
  BroadcastName?: string;
  TeamName?: string;
  TeamColour?: string;
  Line?: number;
}

export interface SessionInfo {
  Key?: number;
  Type?: string; // Practice | Qualifying | Race
  Name?: string; // e.g. "Sprint Qualifying"
  Path?: string;
  Meeting?: { Name?: string; Location?: string; Circuit?: { Key?: number; ShortName?: string } };
  SessionStatus?: string;
  ArchiveStatus?: { Status?: string };
  GmtOffset?: string;
}

export interface RaceControlMessage {
  Utc: string;
  Lap?: number;
  Category?: string;
  Flag?: string;
  Scope?: string;
  Sector?: number;
  RacingNumber?: string;
  Message: string;
}

export interface Weather {
  AirTemp?: string;
  TrackTemp?: string;
  Humidity?: string;
  Pressure?: string;
  Rainfall?: string;
  WindDirection?: string;
  WindSpeed?: string;
}

// ---------- Server <-> browser protocol ----------

export type SourceMode = "live" | "replay";

export interface ReplayStatus {
  path: string;
  title: string;
  cursor: number; // ms since stream start
  duration: number;
  start: number; // ms offset of first "Started" session status (for skip-to-start)
  speed: number;
  playing: boolean;
  loading: boolean;
  telemetry: "loading" | "ready" | "none"; // positions + car data for map/telemetry
}

export interface LiveStatus {
  connected: boolean;
  error?: string;
}

export type ServerMsg =
  | { type: "snapshot"; state: FeedState; source: SourceMode }
  | { type: "delta"; topic: string; delta: unknown }
  | { type: "clock"; now: number }
  | { type: "live"; status: LiveStatus }
  | { type: "replay"; status: ReplayStatus | null };

export type ClientMsg =
  | { cmd: "live" }
  | { cmd: "replay"; path: string; title: string }
  | { cmd: "play" }
  | { cmd: "pause" }
  | { cmd: "speed"; value: number }
  | { cmd: "seek"; ms: number };

export interface SessionListing {
  meeting: string;
  location: string;
  sessions: { name: string; type: string; start: string; path: string }[];
}

// ---------- Championship ----------

export interface ChampionshipEntry {
  CurrentPosition?: number;
  PredictedPosition?: number;
  CurrentPoints?: number;
  PredictedPoints?: number;
}

export interface ChampionshipPrediction {
  Drivers?: Record<string, ChampionshipEntry & { RacingNumber: string }>;
  Teams?: Record<string, ChampionshipEntry & { TeamName: string }>;
}

/** Standings after the most recent archived race/sprint, built from F1's own ChampionshipPrediction. */
export interface Standings {
  season: number;
  after: { meeting: string; session: string; path: string };
  drivers: { num: string; tla: string; name: string; team: string; color: string; points: number; pos: number }[];
  teams: { name: string; color: string; points: number; pos: number }[];
}

// ---------- Track & telemetry (replay only) ----------

export interface LapInfo {
  lap: number;
  time: number; // seconds
  end: number; // stream ms when the lap time was published
}

export interface TrackOutline {
  points: [number, number][];
  rotation: number; // radians; rotate by -rotation to lay the main axis horizontal
}

export interface LapTrace {
  num: string;
  lap: number;
  time: number;
  points: { t: number; d: number; speed: number; throttle: number; brake: number; gear: number; rpm: number }[];
}

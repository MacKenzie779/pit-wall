// Unauthenticated topics we subscribe to (CarData.z / Position.z need an F1 TV token).
export const TOPICS = [
  "Heartbeat",
  "SessionInfo",
  "SessionData",
  "SessionStatus",
  "ArchiveStatus",
  "TrackStatus",
  "LapCount",
  "ExtrapolatedClock",
  "DriverList",
  "TimingData",
  "TimingAppData",
  "TimingStats",
  "TopThree",
  "WeatherData",
  "RaceControlMessages",
  "PitLaneTimeCollection",
  "TeamRadio",
  "ChampionshipPrediction",
  "LapSeries",
] as const;

export type Topic = (typeof TOPICS)[number];

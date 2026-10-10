import { toList } from "../../shared/merge.ts";
import type { RaceControlMessage } from "../../shared/types.ts";

export type SectorFlag = "YELLOW" | "DOUBLE YELLOW";

export interface FlagState {
  red: boolean;
  sectors: Map<number, SectorFlag>;
}

/**
 * Current marshal-sector flags from the race control log. Sector flags are set by
 * "YELLOW/DOUBLE YELLOW IN TRACK SECTOR n" and cleared by "CLEAR IN TRACK SECTOR n";
 * a track-wide green/clear/chequered or TrackStatus "1" (all clear) clears everything.
 */
export function flagState(messages: unknown, trackStatus: string | undefined): FlagState {
  const sectors = new Map<number, SectorFlag>();
  let red = false;
  for (const m of toList<RaceControlMessage>(messages as any)) {
    if (!m || m.Category !== "Flag") continue;
    const flag = (m.Flag ?? "").toUpperCase();
    if (m.Scope === "Sector" && m.Sector != null) {
      if (flag === "YELLOW" || flag === "DOUBLE YELLOW") sectors.set(m.Sector, flag);
      else if (flag === "CLEAR" || flag === "GREEN") sectors.delete(m.Sector);
    } else if (m.Scope === "Track") {
      if (flag === "RED") red = true;
      if (flag === "GREEN" || flag === "CLEAR" || flag === "CHEQUERED") {
        sectors.clear();
        red = false;
      }
    }
  }
  if (trackStatus === "1") sectors.clear();
  if (trackStatus && trackStatus !== "5") red = false;
  if (trackStatus === "5") red = true;
  return { red, sectors };
}

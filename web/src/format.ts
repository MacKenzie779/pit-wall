import type { TimedValue } from "../../shared/types.ts";

/** "HH:MM:SS" → seconds */
export function parseHms(s: string | undefined): number {
  if (!s) return 0;
  const [h = 0, m = 0, sec = 0] = s.split(":").map(Number);
  return h * 3600 + m * 60 + sec;
}

export function fmtHms(totalSec: number): string {
  const t = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** ms → "mm:ss" or "h:mm:ss" */
export function fmtDuration(ms: number): string {
  return fmtHms(ms / 1000);
}

/** "1:32.456" / "32.456" → seconds (NaN if empty) */
export function lapSeconds(v: string | undefined): number {
  if (!v) return NaN;
  const parts = v.split(":");
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
}

/** seconds → "1:29.812" / "59.812" */
export function fmtLap(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(3).padStart(6, "0");
  return m ? `${m}:${sec}` : sec;
}

/** Timing colour class: purple overall best, green personal best. */
export function timingClass(v: TimedValue | undefined, slowerClass = ""): string {
  if (!v?.Value) return "";
  if (v.OverallFastest) return "c-purple";
  if (v.PersonalFastest) return "c-green";
  return slowerClass;
}

export function localTime(utc: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : utc + "Z");
  return d.toLocaleTimeString([], { hour12: false });
}

export const COMPOUND: Record<string, { letter: string; cls: string }> = {
  SOFT: { letter: "S", cls: "tyre-s" },
  MEDIUM: { letter: "M", cls: "tyre-m" },
  HARD: { letter: "H", cls: "tyre-h" },
  INTERMEDIATE: { letter: "I", cls: "tyre-i" },
  WET: { letter: "W", cls: "tyre-w" },
};

export function compound(c: string | undefined) {
  return COMPOUND[c ?? ""] ?? { letter: "?", cls: "tyre-u" };
}

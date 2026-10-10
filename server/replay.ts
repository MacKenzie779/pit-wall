// Replays archived sessions from livetiming.formula1.com/static through the same delta pipeline.

import { join } from "node:path";
import { TOPICS } from "../shared/topics.ts";
import { SessionTelemetry } from "./telemetry.ts";
import type { ReplayStatus, SessionListing } from "../shared/types.ts";

export const STATIC = "https://livetiming.formula1.com/static/";
const TICK_MS = 50;
const TELEMETRY_MS = 100;

export interface ReplayEvent {
  t: number; // ms since stream start
  topic: string;
  data: unknown;
}

const LINE_RE = /^(\d+):(\d\d):(\d\d)\.(\d{3})(.*)$/;

export function parseJsonStream(topic: string, text: string): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = LINE_RE.exec(raw.replace(/^﻿/, ""));
    if (!m) continue;
    const t = ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + +m[4]!;
    try {
      out.push({ t, topic, data: JSON.parse(m[5]!) });
    } catch {}
  }
  return out;
}

/** Stable merge of per-topic event lists into one timeline. */
export function mergeTimelines(lists: ReplayEvent[][]): ReplayEvent[] {
  return lists.flat().sort((a, b) => a.t - b.t);
}

export async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return JSON.parse((await res.text()).replace(/^﻿/, ""));
}

const listingCache = new Map<number, { at: number; data: SessionListing[] }>();

export async function listSessions(year: number): Promise<SessionListing[]> {
  const hit = listingCache.get(year);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const idx = await fetchJson(`${STATIC}${year}/Index.json`);
  const data: SessionListing[] = (idx.Meetings ?? [])
    .map((m: any) => ({
      meeting: m.Name,
      location: m.Location,
      sessions: (m.Sessions ?? [])
        .filter((s: any) => s.Path)
        .map((s: any) => ({ name: s.Name, type: s.Type, start: s.StartDate, path: s.Path })),
    }))
    .filter((m: SessionListing) => m.sessions.length > 0);
  listingCache.set(year, { at: Date.now(), data });
  return data;
}

const CACHE_DIR = join(import.meta.dir, "../.cache/archive");

/**
 * Fetches a topic's .jsonStream. Archives of finished sessions never change, so they are
 * cached on disk (the race's position/telemetry alone is ~25 MB and the CDN is slow).
 */
export async function fetchStream(path: string, topic: string, cacheable: boolean): Promise<ReplayEvent[]> {
  const file = Bun.file(join(CACHE_DIR, path.replace(/[^\w.-]+/g, "_") + topic + ".jsonStream"));
  if (cacheable && (await file.exists())) return parseJsonStream(topic, await file.text());
  const res = await fetch(`${STATIC}${path}${topic}.jsonStream`);
  if (!res.ok) return [];
  const text = await res.text();
  if (cacheable && LINE_RE.test(text.replace(/^\uFEFF/, "").split("\n", 1)[0]!.trimEnd())) await Bun.write(file, text);
  return parseJsonStream(topic, text);
}

export interface ReplayHandlers {
  reset(): void;
  delta(topic: string, delta: unknown, silent?: boolean): void;
  /** Called after a silent fast-forward so the hub can broadcast a fresh snapshot. */
  resync(): void;
  status(s: ReplayStatus): void;
}

export class ReplayPlayer {
  private events: ReplayEvent[] = [];
  private idx = 0;
  private cursor = 0;
  private speed = 1;
  private playing = false;
  private loading = true;
  private start = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastStatus = 0;
  private lastTelemetry = 0;
  private startUtc = 0; // wall-clock UTC of stream offset 0, from Heartbeat
  telemetry: SessionTelemetry | null = null;
  private telemetryDone = false;
  private disposed = false;

  constructor(
    readonly path: string,
    readonly title: string,
    private h: ReplayHandlers,
  ) {}

  async load() {
    this.emitStatus();
    const idx = await fetchJson(`${STATIC}${this.path}Index.json`);
    const feeds = Object.keys(idx.Feeds ?? {});
    // Only finished sessions are cached (a session still in progress keeps growing).
    const status = feeds.includes("SessionStatus") ? await fetchStream(this.path, "SessionStatus", false) : [];
    const cacheable = ["Finalised", "Ends"].includes((status.at(-1)?.data as any)?.Status);
    const topics = feeds.filter((f) => (TOPICS as readonly string[]).includes(f));
    const base = mergeTimelines(await Promise.all(topics.map((t) => fetchStream(this.path, t, cacheable))));

    const hb = base.find((e) => e.topic === "Heartbeat");
    if (hb) this.startUtc = Date.parse((hb.data as any).Utc) - hb.t;
    const started = base.find((e) => e.topic === "SessionStatus" && (e.data as any)?.Status === "Started");
    this.start = started ? Math.max(0, started.t - 60_000) : 0;

    this.events = base;
    this.loading = false;
    // Jump to just before the session goes green (races have ~2h of pre-session data).
    this.seek(this.start);
    this.play();

    // Positions/telemetry are big: load them in the background while the replay runs.
    if (this.startUtc && feeds.includes("Position.z")) {
      const [pos, car] = await Promise.all([
        fetchStream(this.path, "Position.z", cacheable),
        feeds.includes("CarData.z") ? fetchStream(this.path, "CarData.z", cacheable) : [],
      ]);
      if (this.disposed) return;
      const tel = new SessionTelemetry();
      // Skip hours of pre-session garage time.
      tel.ingest(pos, car, this.startUtc, this.start - 120_000);
      tel.indexLaps(base.filter((e) => e.topic === "TimingData"));
      tel.buildOutline();
      if (tel.pos.size) this.telemetry = tel;
      this.emitTelemetry(false);
    }
    this.telemetryDone = true;
    this.emitStatus();
  }

  get cursorMs() {
    return this.cursor;
  }

  /** Virtual "now" in UTC ms, for extrapolating session clocks. */
  now() {
    return this.startUtc ? this.startUtc + this.cursor : Date.now();
  }

  get duration() {
    return this.events.at(-1)?.t ?? 0;
  }

  play() {
    if (this.loading || this.playing) return;
    if (this.cursor >= this.duration) this.seek(this.start);
    this.playing = true;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emitStatus();
  }

  pause() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emitStatus();
  }

  setSpeed(v: number) {
    this.speed = Math.max(0.25, Math.min(v, 60));
    this.emitStatus();
  }

  seek(ms: number) {
    if (this.loading) return;
    ms = Math.max(0, Math.min(ms, this.duration));
    if (ms < this.cursor || this.idx === 0) {
      this.h.reset();
      this.idx = 0;
    }
    while (this.idx < this.events.length && this.events[this.idx]!.t <= ms) {
      const e = this.events[this.idx++]!;
      this.h.delta(e.topic, e.data, true);
    }
    this.cursor = ms;
    this.emitTelemetry(true);
    this.h.resync();
    this.emitStatus();
  }

  dispose() {
    this.disposed = true;
    this.pause();
    this.events = [];
    this.telemetry = null;
  }

  private tick() {
    const nowPerf = performance.now();
    this.cursor += (nowPerf - this.lastTick) * this.speed;
    this.lastTick = nowPerf;
    while (this.idx < this.events.length && this.events[this.idx]!.t <= this.cursor) {
      const e = this.events[this.idx++]!;
      this.h.delta(e.topic, e.data);
    }
    if (nowPerf - this.lastTelemetry >= TELEMETRY_MS) this.emitTelemetry(false);
    if (this.idx >= this.events.length) {
      this.cursor = this.duration;
      this.pause();
      return;
    }
    if (nowPerf - this.lastStatus > 500) this.emitStatus();
  }

  /** Positions and car data are sampled at the cursor rather than replayed event by event. */
  private emitTelemetry(silent: boolean) {
    const tel = this.telemetry;
    if (!tel) return;
    this.lastTelemetry = performance.now();
    this.h.delta("Position", { Entries: tel.positionsAt(this.cursor) }, silent);
    this.h.delta("CarData", { Cars: tel.carAt(this.cursor) }, silent);
  }

  private emitStatus() {
    this.lastStatus = performance.now();
    this.h.status({
      path: this.path,
      title: this.title,
      cursor: this.cursor,
      duration: this.duration,
      start: this.start,
      speed: this.speed,
      playing: this.playing,
      loading: this.loading,
      telemetry: this.telemetry ? "ready" : this.telemetryDone ? "none" : "loading",
    });
  }
}

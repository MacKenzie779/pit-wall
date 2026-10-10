// Holds the merged feed state, owns the active source (live or replay) and fans out to browsers.

import type { ServerWebSocket } from "bun";
import { applyDelta, type FeedState } from "../shared/merge.ts";
import type { ClientMsg, LiveStatus, ReplayStatus, ServerMsg, SourceMode } from "../shared/types.ts";
import { LiveClient } from "./signalr.ts";
import { ReplayPlayer } from "./replay.ts";
import { LiveMap, loadCalibration } from "./livemap.ts";

const FLUSH_MS = 100;
const CLOCK_MS = 250;
const LIVEMAP_MS = 250;

export class Hub {
  private state: FeedState = {};
  private source: SourceMode = "live";
  private clients = new Set<ServerWebSocket<unknown>>();
  private queue: ServerMsg[] = [];
  private liveStatus: LiveStatus = { connected: false };
  private replayStatus: ReplayStatus | null = null;
  private replay: ReplayPlayer | null = null;
  private restartedFor: unknown = null;
  private liveMap: LiveMap | null = null;
  private calibrating: number | null = null;
  private liveMapSession: unknown = null;

  private live = new LiveClient({
    snapshot: (s) => {
      if (this.source !== "live") return;
      this.state = s as FeedState;
      this.recordGaps(Object.keys(this.state.TimingData?.Lines ?? {}));
      this.liveMap?.seed(this.state.TimingData?.Lines ?? {}, Date.now());
      this.setupLiveMap();
      // A fresh keyframe replaces all state; keep the live map's marker.
      if (this.liveMap) this.state = { ...this.state, TrackMeta: { mode: "estimated", from: this.liveMap.cal.from } };
      this.broadcastSnapshot();
    },
    delta: (topic, delta) => {
      if (this.source !== "live") return;
      // A new session on a long-lived connection: resubscribe for a clean keyframe.
      // (Once per session: if the new keyframe still shows the old session, take the delta as is.)
      const key = (delta as any)?.Key;
      if (topic === "SessionInfo" && key && key !== this.state.SessionInfo?.Key && this.restartedFor !== key) {
        this.restartedFor = key;
        this.live.restart();
        return;
      }
      if (topic === "TimingData") this.liveMap?.onTiming(delta, Date.now());
      this.apply(topic, delta);
      if (topic === "SessionInfo") this.setupLiveMap();
    },
    status: (connected, error) => {
      this.liveStatus = { connected, error };
      this.push({ type: "live", status: this.liveStatus });
    },
  });

  constructor() {
    setInterval(() => this.flush(), FLUSH_MS);
    setInterval(() => this.push({ type: "clock", now: this.now() }), CLOCK_MS);
    setInterval(() => this.tickLiveMap(), LIVEMAP_MS);
    this.live.start();
  }

  /** Live sessions: estimated car positions from mini-sector completions (see livemap.ts). */
  private setupLiveMap() {
    const circuit = this.state.SessionInfo?.Meeting?.Circuit?.Key as number | undefined;
    const session = this.state.SessionInfo?.Key;
    if (this.liveMap && session !== this.liveMapSession) {
      // New session at the same circuit: keep the calibration, forget where cars were.
      this.liveMap = new LiveMap(this.liveMap.cal);
      this.liveMap.seed(this.state.TimingData?.Lines ?? {}, Date.now());
    }
    this.liveMapSession = session;
    if (!circuit || this.liveMap?.cal.circuitKey === circuit || this.calibrating === circuit) return;
    this.liveMap = null;
    this.calibrating = circuit;
    loadCalibration(circuit, this.state.SessionInfo?.Path ?? "")
      .then((cal) => {
        if (this.calibrating !== circuit) return;
        this.calibrating = null;
        if (!cal) {
          this.setMeta({ mode: "unavailable" });
          return;
        }
        this.liveMap = new LiveMap(cal);
        this.liveMap.seed(this.state.TimingData?.Lines ?? {}, Date.now());
        this.setMeta({ mode: "estimated", from: cal.from });
      })
      .catch((err) => {
        console.error("live map calibration failed:", err);
        this.calibrating = null;
        this.setMeta({ mode: "unavailable" });
      });
  }

  private setMeta(meta: Record<string, unknown>) {
    if (this.source !== "live") return;
    this.state = { ...this.state, TrackMeta: meta };
    this.push({ type: "delta", topic: "TrackMeta", delta: meta });
  }

  private tickLiveMap() {
    if (this.source !== "live" || !this.liveMap || !this.clients.size) return;
    const entries = this.liveMap.positionsAt(Date.now(), this.state.TimingData?.Lines ?? {});
    this.state = { ...this.state, Position: { Entries: entries } };
    this.push({ type: "delta", topic: "Position", delta: { Entries: entries } });
  }

  /** Track outline for the active source: real GPS in replay, calibration live. */
  get outline() {
    if (this.source === "replay") return this.replay?.telemetry?.outline ?? null;
    return this.liveMap?.cal.outline ?? null;
  }

  private now() {
    return this.source === "replay" && this.replay ? this.replay.now() : Date.now();
  }

  open(ws: ServerWebSocket<unknown>) {
    this.clients.add(ws);
    const hello: ServerMsg[] = [
      { type: "snapshot", state: this.state, source: this.source },
      { type: "live", status: this.liveStatus },
      { type: "replay", status: this.replayStatus },
      { type: "clock", now: this.now() },
    ];
    ws.send(JSON.stringify(hello));
  }

  close(ws: ServerWebSocket<unknown>) {
    this.clients.delete(ws);
  }

  command(msg: ClientMsg) {
    switch (msg.cmd) {
      case "live":
        this.stopReplay();
        this.source = "live";
        this.state = {};
        this.liveMap = null;
        this.calibrating = null;
        this.broadcastSnapshot();
        this.live.stop();
        this.live.start();
        break;
      case "replay":
        void this.startReplay(msg.path, msg.title);
        break;
      case "play":
        this.replay?.play();
        break;
      case "pause":
        this.replay?.pause();
        break;
      case "speed":
        this.replay?.setSpeed(msg.value);
        break;
      case "seek":
        this.replay?.seek(msg.ms);
        break;
    }
  }

  private async startReplay(path: string, title: string) {
    this.stopReplay();
    this.live.stop();
    this.source = "replay";
    this.state = {};
    this.broadcastSnapshot();
    const player = new ReplayPlayer(path, title, {
      reset: () => {
        this.state = {};
      },
      delta: (topic, delta, silent) => {
        if (this.replay !== player) return;
        this.apply(topic, delta, silent);
      },
      resync: () => {
        if (this.replay === player) this.broadcastSnapshot();
      },
      status: (s) => {
        if (this.replay !== player) return;
        this.replayStatus = s;
        this.push({ type: "replay", status: s });
      },
    });
    this.replay = player;
    try {
      await player.load();
    } catch (err) {
      console.error("replay load failed:", err);
      if (this.replay === player) {
        this.stopReplay();
        this.command({ cmd: "live" });
      }
    }
  }

  private stopReplay() {
    this.replay?.dispose();
    this.replay = null;
    this.replayStatus = null;
    this.push({ type: "replay", status: null });
  }

  private apply(topic: string, delta: unknown, silent = false) {
    this.state = applyDelta(this.state, topic, delta);
    if (!silent) this.push({ type: "delta", topic, delta });
    if (topic === "SessionStatus") this.recordGrid(silent);
    if (topic === "TimingData") {
      const lines = (delta as any)?.Lines ?? {};
      const extra = this.recordGaps(Object.keys(lines).filter((n) => lines[n]?.NumberOfLaps != null), true);
      if (extra && !silent) this.push({ type: "delta", topic: "GapHistory", delta: extra });
    }
  }

  /**
   * Derived topic GapHistory {num: {lap: secondsToLeader}}: the gap to the leader as each car
   * completes a lap (races only). Gap updates stream continuously, so the merged value at
   * the lap-count update is the gap at the line.
   */
  private recordGaps(nums: string[], returnDelta = false): Record<string, Record<string, number>> | null {
    if (this.state.SessionInfo?.Type !== "Race" || !nums.length) return null;
    const out: Record<string, Record<string, number>> = {};
    for (const num of nums) {
      const line = this.state.TimingData?.Lines?.[num];
      const lap = line?.NumberOfLaps;
      const gap = parseGap(line?.GapToLeader, line?.Line);
      if (!lap || gap == null) continue;
      out[num] = { [lap]: gap };
    }
    if (!Object.keys(out).length) return null;
    this.state = applyDelta(this.state, "GapHistory", out);
    return returnDelta ? out : null;
  }

  /**
   * Derived topic StartingGrid {num: position}: the running order when a race first goes green.
   * F1's own grid data (LapSeries lap 0, TimingAppData GridPos) is sometimes wrong — e.g. in the
   * 2026 Singapore sprint a placeholder put NOR on P1 and the real grid message skipped him.
   */
  private recordGrid(silent: boolean) {
    if (this.state.StartingGrid) return;
    const grid = gridAtStart(this.state);
    if (!grid) return;
    this.state = applyDelta(this.state, "StartingGrid", grid);
    if (!silent) this.push({ type: "delta", topic: "StartingGrid", delta: grid });
  }

  get replayPlayer() {
    return this.source === "replay" ? this.replay : null;
  }

  /** Full state replaces anything queued (queued deltas belong to the old state). */
  private broadcastSnapshot() {
    this.queue = this.queue.filter((m) => m.type !== "delta");
    this.queue.push({ type: "snapshot", state: this.state, source: this.source });
    this.flush();
  }

  private push(msg: ServerMsg) {
    this.queue.push(msg);
  }

  private flush() {
    if (!this.queue.length) return;
    const frame = JSON.stringify(this.queue);
    this.queue = [];
    for (const ws of this.clients) ws.send(frame);
  }
}

/** "+12.345" → 12.345, leader ("LAP 31" / "") → 0, lapped ("1L") → null */
function parseGap(v: string | undefined, line: number | undefined): number | null {
  if (line === 1) return 0;
  if (!v) return null;
  if (/L/.test(v)) return null;
  const n = Number(v.replace("+", ""));
  return Number.isFinite(n) ? n : null;
}

/** Running order at the moment a race/sprint is Started, or null if that isn't now. */
export function gridAtStart(state: FeedState): Record<string, number> | null {
  if (state.SessionInfo?.Type !== "Race" || state.SessionStatus?.Status !== "Started") return null;
  const grid: Record<string, number> = {};
  for (const [num, line] of Object.entries<any>(state.TimingData?.Lines ?? {})) if (line?.Line) grid[num] = line.Line;
  return Object.keys(grid).length ? grid : null;
}

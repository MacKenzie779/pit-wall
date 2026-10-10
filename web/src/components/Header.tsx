import { remainingSeconds, sessionKind, trackState } from "../derive.ts";
import { fmtHms } from "../format.ts";
import { useStore } from "../store.ts";
import type { View } from "../App.tsx";

const TABS: { view: View; label: string; key: string }[] = [
  { view: "timing", label: "TIMING", key: "T" },
  { view: "track", label: "TRACK", key: "M" },
  { view: "charts", label: "CHARTS", key: "C" },
  { view: "standings", label: "STANDINGS", key: "W" },
];

export function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  const feed = useStore((s) => s.feed);
  const now = useStore((s) => s.now);
  const source = useStore((s) => s.source);
  const live = useStore((s) => s.live);
  const replay = useStore((s) => s.replay);
  const socket = useStore((s) => s.socket);

  const info = feed.SessionInfo ?? {};
  const kind = sessionKind(info);
  const ts = trackState(feed);
  const rem = remainingSeconds(feed, now);
  const lap = feed.LapCount as { CurrentLap?: number; TotalLaps?: number } | undefined;
  const part = feed.TimingData?.SessionPart as number | undefined;
  const status: string = feed.SessionStatus?.Status ?? info.SessionStatus ?? "—";
  const ended = status === "Finalised" || status === "Ends";

  const upstreamOk = source === "replay" ? !!replay && !replay.loading : live.connected;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">PIT WALL</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.view} className={view === t.view ? "on" : ""} onClick={() => onView(t.view)} title={t.key}>
              {t.label}
              {t.view === "standings" && kind === "race" && status === "Started" && <span className="tab-live">●</span>}
            </button>
          ))}
        </nav>
        <div className="tb-cell tb-event">
          <div className="tb-label">{info.Meeting?.Location ?? "—"}</div>
          <div className="tb-value">{(info.Meeting?.Name ?? "Waiting for feed").toUpperCase()}</div>
        </div>
        <div className="tb-cell">
          <div className="tb-label">SESSION</div>
          <div className="tb-value">
            {(info.Name ?? "—").toUpperCase()}
            {kind === "quali" && part ? (
              <span className="tag tag-amber">{(info.Name ?? "").startsWith("Sprint") ? "SQ" : "Q"}{part}</span>
            ) : null}
          </div>
        </div>
        <div className="tb-cell">
          <div className="tb-label">TRACK</div>
          <div className={`tb-value ts-pill ${ts.cls}`}>{ts.label}</div>
        </div>
        {kind === "race" && lap?.TotalLaps ? (
          <div className="tb-cell">
            <div className="tb-label">LAP</div>
            <div className="tb-value tb-big">
              {lap.CurrentLap ?? 0}
              <span className="dim">/{lap.TotalLaps}</span>
            </div>
          </div>
        ) : null}
        <div className="tb-cell">
          <div className="tb-label">REMAINING</div>
          <div className="tb-value tb-big c-amber">{rem == null ? "--:--" : fmtHms(rem)}</div>
        </div>
        <div className="tb-cell">
          <div className="tb-label">STATUS</div>
          <div className={`tb-value ${status === "Started" ? "c-phosphor" : status === "Aborted" ? "c-red" : "dim"}`}>
            {status.toUpperCase()}
          </div>
        </div>
        <div className="tb-spacer" />
        <div className="tb-cell tb-source">
          <div className="tb-label">SOURCE</div>
          <div className="tb-value">
            {source === "live" ? (
              <span className={ended ? "dim" : "c-red blink-slow"}>● {ended ? "LIVE · IDLE" : "LIVE"}</span>
            ) : (
              <span className="c-amber">▶ REPLAY {replay ? `${replay.speed}×` : ""}</span>
            )}
          </div>
        </div>
        <div className="tb-cell">
          <div className="tb-label">LINK</div>
          <div className="tb-value">
            <span className={socket ? "c-phosphor" : "c-red"} title="browser ↔ server">■</span>
            <span className={upstreamOk ? "c-phosphor" : "c-red"} title={live.error ?? "server ↔ F1"}>■</span>
          </div>
        </div>
      </header>
      {(ts.cls === "ts-sc" || ts.cls === "ts-red") && <div className={`band ${ts.cls}`}>{ts.label}</div>}
      {source === "live" && ended && (
        <div className="band band-info">
          NO LIVE SESSION — SHOWING LAST SESSION'S FINAL STATE · PICK A REPLAY BELOW
        </div>
      )}
    </>
  );
}

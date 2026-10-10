import type { Row } from "../derive.ts";
import { buildStandings, isRaceSession, useBaseStandings, type StandRow } from "../standings.ts";
import { useFlash } from "../hooks.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

export function StandingsView({ rows }: { rows: Row[] }) {
  const feed = useStore((s) => s.feed);
  const source = useStore((s) => s.source);
  const race = isRaceSession(feed);
  const exclude = race ? (feed.SessionInfo?.Path ?? "") : "";
  const { data: base, error } = useBaseStandings(exclude);
  const model = buildStandings(feed, rows, base, source === "live");
  const status: string = feed.SessionStatus?.Status ?? "";

  if (!model) {
    return (
      <div className="standings">
        <div className="empty">{error ? `STANDINGS UNAVAILABLE: ${error}` : "LOADING STANDINGS…"}</div>
      </div>
    );
  }

  const projecting = model.mode !== "static";
  const banner = !projecting
    ? null
    : status === "Started"
      ? { text: "LIVE PROJECTION · IF THE RACE ENDED NOW", cls: "c-red blink-slow" }
      : status === "Finished" || status === "Finalised" || status === "Ends"
        ? { text: "PROVISIONAL · INCLUDES THIS SESSION", cls: "c-amber" }
        : { text: "PROJECTION · SESSION NOT RUNNING", cls: "dim" };

  return (
    <div className="standings">
      <div className="standings-bar">
        <span className="panel-title">▌CHAMPIONSHIP</span>
        {banner && <span className={banner.cls}>● {banner.text}</span>}
        <span className="dim">
          {model.mode === "official" ? "SOURCE: F1 CHAMPIONSHIP PREDICTION" : model.mode === "computed" ? "SOURCE: CALCULATED FROM RUNNING ORDER" : ""}
          {model.baseLabel && model.mode !== "official" ? ` · BASE ${model.baseLabel.toUpperCase()}` : ""}
        </span>
      </div>
      <div className="standings-grid">
        <Table title="DRIVERS" rows={model.drivers} drivers projecting={projecting} />
        <Table title="CONSTRUCTORS" rows={model.teams} projecting={projecting} />
      </div>
      {source === "replay" && !projecting && (
        <div className="standings-note dim">Replay of a non-race session — showing current-season standings.</div>
      )}
    </div>
  );
}

function Table(props: { title: string; rows: StandRow[]; drivers?: boolean; projecting: boolean }) {
  const { rows, drivers, projecting } = props;
  const leader = rows[0]?.projected ?? 0;
  const anyLive = rows.some((r) => r.racePos);
  return (
    <Panel title={props.title} className="stand-panel" right={<span className="dim">{rows.length}</span>}>
      <div className={`st-grid ${drivers ? "st-drivers" : "st-teams"} ${projecting ? "st-proj" : ""}`}>
        <div className="tr th">
          <span className="td">POS</span>
          <span className="td">{projecting ? "±" : ""}</span>
          <span className="td">{drivers ? "DRIVER" : "TEAM"}</span>
          {drivers && <span className="td r">{projecting && anyLive ? "RACE" : ""}</span>}
          <span className="td r">{projecting ? "BEFORE" : "PTS"}</span>
          {projecting && <span className="td r">+PTS</span>}
          {projecting && <span className="td r">PROJ</span>}
          <span className="td r">GAP</span>
        </div>
        {rows.map((r) => (
          <StandingRow key={r.id} r={r} leader={leader} drivers={!!drivers} projecting={projecting} />
        ))}
      </div>
    </Panel>
  );
}

function StandingRow({ r, leader, drivers, projecting }: { r: StandRow; leader: number; drivers: boolean; projecting: boolean }) {
  const moved = r.basePos - r.pos;
  const flash = useFlash(r.pos);
  const gap = leader - r.projected;
  return (
    <div className={`tr ${r.out ? "tr-dim" : ""} ${projecting && moved ? "st-moved" : ""}`}>
      <span className={`td pos ${flash}`}>{r.pos}</span>
      <span className="td delta">
        {projecting && moved ? (
          <span className={moved > 0 ? "c-green" : "c-red"}>
            {moved > 0 ? "▲" : "▼"}
            {Math.abs(moved)}
          </span>
        ) : null}
      </span>
      <span className="td drv" title={r.sub}>
        <i className="team" style={{ background: r.color }} />
        {drivers && <span className="num">{r.num}</span>}
        <span className="tla">{drivers ? r.label : r.label.toUpperCase()}</span>
        {drivers && <span className="st-name dim">{r.sub}</span>}
      </span>
      {drivers && (
        <span className="td r">
          {projecting && r.racePos ? <span className={r.out ? "c-red" : "dim2"}>{r.out ? "OUT" : `P${r.racePos}`}</span> : null}
        </span>
      )}
      <span className={`td r ${projecting ? "dim2" : "c-white st-pts"}`}>{fmt(r.points)}</span>
      {projecting && <span className={`td r ${r.gain > 0 ? "c-phosphor" : "dim"}`}>{r.gain > 0 ? `+${fmt(r.gain)}` : "·"}</span>}
      {projecting && <span className="td r c-white st-pts">{fmt(r.projected)}</span>}
      <span className="td r dim2">{gap > 0 ? `-${fmt(gap)}` : ""}</span>
    </div>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

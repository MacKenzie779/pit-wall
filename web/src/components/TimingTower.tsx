import { Fragment, memo } from "react";
import type { Row, SessionKind } from "../derive.ts";
import { compound, fmtLap, timingClass } from "../format.ts";
import { useFlash } from "../hooks.ts";
import { Panel } from "./Panel.tsx";

const COLS: Record<SessionKind, string[]> = {
  race: ["POS", "±", "DRIVER", "GAP", "INT", "LAST", "BEST", "S1", "S2", "S3", "TYRE", "PIT", ""],
  quali: ["POS", "", "DRIVER", "BEST", "GAP", "INT", "LAST", "PROJ", "S1", "S2", "S3", "TYRE", "LAPS", ""],
  practice: ["POS", "", "DRIVER", "BEST", "GAP", "INT", "LAST", "S1", "S2", "S3", "TYRE", "LAPS", ""],
};

const SEG_CLASS: Record<number, string> = {
  2048: "seg-yellow",
  2049: "seg-green",
  2051: "seg-purple",
  2064: "seg-pit",
};

function MiniSectors({ segments }: { segments: number[] }) {
  if (!segments.length) return <div className="segs" />;
  return (
    <div className="segs">
      {segments.map((s, i) => (
        <i key={i} className={SEG_CLASS[s] ?? (s ? "seg-other" : "")} />
      ))}
    </div>
  );
}

function Flashing({ value, className = "" }: { value: string; className?: string }) {
  const flash = useFlash(value);
  return <span className={`${className} ${flash}`}>{value || " "}</span>;
}

const TowerRow = memo(function TowerRow({ r, kind }: { r: Row; kind: SessionKind }) {
  const posFlash = useFlash(r.line);
  const t = r.tyre ? compound(r.tyre.compound) : null;
  const gapCell = <Flashing value={r.gap} />;
  const intCell = <Flashing value={r.interval} className={r.catching ? "c-phosphor" : ""} />;
  const bestCell = <span className={kind === "race" ? "" : "c-white"}>{r.best}</span>;
  const dimRow = r.retired || r.knockedOut;

  return (
    <div className={`tr ${dimRow ? "tr-dim" : ""} ${r.status === "PIT" ? "tr-pit" : ""}`}>
      <span className={`td pos ${posFlash}`}>{r.line}</span>
      <span className="td delta">
        {r.gridDelta ? (
          <span className={r.gridDelta > 0 ? "c-green" : "c-red"}>
            {r.gridDelta > 0 ? "▲" : "▼"}
            {Math.abs(r.gridDelta)}
          </span>
        ) : null}
      </span>
      <span className="td drv" title={`${r.name} · ${r.team}`}>
        <i className="team" style={{ background: r.color }} />
        <span className="num">{r.num}</span>
        <span className="tla">{r.tla}</span>
      </span>
      {kind === "race" ? (
        <>
          <span className="td t">{gapCell}</span>
          <span className="td t">{intCell}</span>
        </>
      ) : (
        <>
          <span className="td t">{bestCell}</span>
          <span className="td t">{gapCell}</span>
          <span className="td t">{intCell}</span>
        </>
      )}
      <span className="td t">
        <Flashing value={r.last.Value ?? ""} className={timingClass(r.last)} />
      </span>
      {kind === "race" && <span className="td t dim2">{r.best}</span>}
      {kind === "quali" && (
        <span
          className="td t proj"
          title={
            r.projection
              ? `${r.projection.done} sector(s) done + ${r.projection.estimated ? "best sector(s) (session best scaled to this lap's pace where no clean personal best yet)" : "personal-best sector(s)"}` +
                (r.projection.delta != null ? ` · ${r.projection.delta >= 0 ? "+" : ""}${r.projection.delta.toFixed(3)} vs own best` : "")
              : ""
          }
        >
          {r.projection && (
            <>
              <span className={r.projection.cls}>
                {r.projection.estimated ? "≈" : ""}
                {fmtLap(r.projection.time)}
              </span>
              <span className={`proj-pos ${r.projection.out ? "proj-out" : ""}`}>P{r.projection.pos}</span>
            </>
          )}
        </span>
      )}
      {r.sectors.map((s, i) => (
        <span key={i} className="td sec">
          <span className={`${s.cls} ${s.stale ? "dim" : ""}`}>{s.value || " "}</span>
          <MiniSectors segments={s.segments} />
        </span>
      ))}
      <span className="td tyre">
        {t && r.tyre && (
          <>
            <span className={`tyre-badge ${t.cls} ${r.tyre.isNew ? "" : "used"}`}>{t.letter}</span>
            <span className="tyre-age">{r.tyre.age ?? 0}</span>
          </>
        )}
      </span>
      {kind === "race" ? (
        <span className="td n" title={`${r.pits} tyre change(s) · ${r.pitLanePasses} pit lane pass(es)`}>
          {r.pits}
        </span>
      ) : (
        <span className="td n">{r.laps ?? ""}</span>
      )}
      <span className="td st">{r.status && <span className={`st-tag st-${r.status}`}>{r.status}</span>}</span>
    </div>
  );
});

export function TimingTower({ kind, rows, cutoff }: { kind: SessionKind; rows: Row[]; cutoff: number | null }) {
  return (
    <Panel
      title="TIMING"
      className="tower"
      right={<span className="dim">{kind === "race" ? "RACE" : kind === "quali" ? "QUALIFYING" : "PRACTICE"} · {rows.length} CARS</span>}
    >
      <div className={`grid grid-${kind}`}>
        <div className="tr th">
          {COLS[kind].map((c, i) => (
            <span key={i} className="td">
              {c}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <Fragment key={r.num}>
            <TowerRow r={r} kind={kind} />
            {cutoff && r.line === cutoff && <div className="cutoff">ELIMINATION ZONE</div>}
          </Fragment>
        ))}
        {!rows.length && <div className="empty">AWAITING TIMING DATA…</div>}
      </div>
    </Panel>
  );
}

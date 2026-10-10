import type { Row } from "../derive.ts";
import { compound } from "../format.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

export function TyreStints({ rows }: { rows: Row[] }) {
  const lapCount = useStore((s) => s.feed.LapCount) as { CurrentLap?: number; TotalLaps?: number } | undefined;

  const stintLaps = rows.map((r) =>
    r.stints.map((s) => ({ c: s.Compound, laps: Math.max(0, (s.TotalLaps ?? 0) - (s.StartLaps ?? 0)), isNew: s.New === "true" })),
  );
  const used = Math.max(1, ...stintLaps.map((st) => st.reduce((a, s) => a + s.laps, 0)));
  const scale = Math.max(used, lapCount?.TotalLaps ?? 0);
  const current = lapCount?.CurrentLap;

  return (
    <Panel title="TYRE STRATEGY" className="stints" right={<span className="dim">0 — {scale} LAPS</span>}>
      <div className="stint-rows">
        {rows.map((r, i) => (
          <div key={r.num} className={`stint-row ${r.retired ? "tr-dim" : ""}`}>
            <span className="stint-tla">
              <i className="team" style={{ background: r.color }} />
              {r.tla}
            </span>
            <span className="stint-track">
              {stintLaps[i]!.map((s, j) => {
                const c = compound(s.c);
                return (
                  <span
                    key={j}
                    className={`stint ${c.cls} ${s.isNew ? "" : "used"}`}
                    style={{ width: `${(s.laps / scale) * 100}%` }}
                    title={`${s.c ?? "?"} · ${s.laps} laps${s.isNew ? "" : " (used)"}`}
                  >
                    {s.laps / scale > 0.06 ? c.letter : ""}
                  </span>
                );
              })}
              {current && lapCount?.TotalLaps ? (
                <i className="stint-now" style={{ left: `${(current / scale) * 100}%` }} />
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

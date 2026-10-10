import { useMemo, useState } from "react";
import { toList } from "../../../shared/merge.ts";
import type { Driver } from "../../../shared/types.ts";
import type { Row } from "../derive.ts";
import { isRaceSession } from "../standings.ts";
import { useSize } from "../hooks.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

interface DriverSeries {
  num: string;
  tla: string;
  color: string;
  dashed: boolean; // second driver of a team
  points: [number, number][]; // [lap, value]
}

const RANGES = [10, 30, 60, 0] as const; // 0 = all

export function ChartsView({ rows }: { rows: Row[] }) {
  const feed = useStore((s) => s.feed);
  const [focus, setFocus] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<(typeof RANGES)[number]>(60);
  const drivers = (feed.DriverList ?? {}) as Record<string, Driver>;

  // Teammates share a colour; the higher car number gets a dashed line.
  const dashed = useMemo(() => {
    const byTeam = new Map<string, string[]>();
    for (const d of Object.values(drivers)) {
      if (!d?.TeamName) continue;
      byTeam.set(d.TeamName, [...(byTeam.get(d.TeamName) ?? []), d.RacingNumber]);
    }
    const out = new Set<string>();
    for (const nums of byTeam.values()) nums.sort((a, b) => Number(a) - Number(b)).slice(1).forEach((n) => out.add(n));
    return out;
  }, [drivers]);

  const meta = (num: string) => ({
    num,
    tla: drivers[num]?.Tla ?? num,
    color: `#${drivers[num]?.TeamColour ?? "888888"}`,
    dashed: dashed.has(num),
  });

  const grid = feed.StartingGrid as Record<string, number> | undefined;
  const positions: DriverSeries[] = useMemo(
    () =>
      Object.entries((feed.LapSeries ?? {}) as Record<string, { LapPosition?: string[] | Record<string, string> }>)
        .filter(([num]) => drivers[num])
        .map(([num, s]) => ({
          ...meta(num),
          points: toList(s.LapPosition)
            // Lap 0 is the grid; prefer the order recorded at the start (F1's can be wrong).
            .map((p, lap) => [lap, Number(lap === 0 && grid?.[num] ? grid[num] : p)] as [number, number])
            .filter(([, p]) => p > 0),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.LapSeries, feed.StartingGrid, drivers, dashed],
  );

  const gaps: DriverSeries[] = useMemo(
    () =>
      Object.entries((feed.GapHistory ?? {}) as Record<string, Record<string, number>>)
        .filter(([num]) => drivers[num])
        .map(([num, h]) => ({
          ...meta(num),
          points: Object.entries(h)
            .map(([lap, g]) => [Number(lap), g] as [number, number])
            .sort((p, q) => p[0] - q[0]),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.GapHistory, drivers, dashed],
  );

  if (!isRaceSession(feed)) {
    return (
      <main className="main main-single">
        <div className="notice">
          <div className="c-amber">▌CHARTS · RACES & SPRINTS</div>
          <p>Position-by-lap and gap-to-leader charts appear during a race or sprint (live or in replay).</p>
        </div>
      </main>
    );
  }

  const toggle = (num: string) =>
    setFocus((f) => {
      const n = new Set(f);
      if (n.has(num)) n.delete(num);
      else n.add(num);
      return n;
    });

  return (
    <main className="main main-charts">
      <div className="chip-row">
        <span className="dim">FOCUS</span>
        {rows.map((r) => {
          const m = meta(r.num);
          return (
            <button key={r.num} className={`chip ${focus.has(r.num) ? "on-chip" : ""}`} onClick={() => toggle(r.num)}>
              <svg width="14" height="6">
                <line x1="0" x2="14" y1="3" y2="3" stroke={m.color} strokeWidth="2" strokeDasharray={m.dashed ? "4 3" : undefined} />
              </svg>
              {m.tla}
            </button>
          );
        })}
        {focus.size > 0 && (
          <button className="chip" onClick={() => setFocus(new Set())}>
            CLEAR
          </button>
        )}
      </div>
      <Panel title="POSITION BY LAP" className="chart-panel">
        <LapChart series={positions} focus={focus} kind="position" onToggle={toggle} />
      </Panel>
      <Panel
        title="GAP TO LEADER"
        className="chart-panel"
        right={
          <span className="range-picks">
            {RANGES.map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r ? `${r}s` : "ALL"}
              </button>
            ))}
          </span>
        }
      >
        <LapChart series={gaps} focus={focus} kind="gap" range={range} onToggle={toggle} />
      </Panel>
    </main>
  );
}

const ML = 40;
const MR = 44;
const MT = 10;
const MB = 22;

function LapChart(props: {
  series: DriverSeries[];
  focus: Set<string>;
  kind: "position" | "gap";
  range?: number;
  onToggle: (num: string) => void;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hoverLap, setHoverLap] = useState<number | null>(null);
  const { series, focus, kind } = props;

  const withData = series.filter((s) => s.points.length);
  if (!withData.length) {
    return (
      <div className="chart-wrap" ref={ref}>
        <div className="empty">
          {kind === "gap" ? "GAP HISTORY BUILDS UP LAP BY LAP WHILE THE DASHBOARD IS RUNNING" : "WAITING FOR LAP DATA…"}
        </div>
      </div>
    );
  }

  const width = Math.max(320, size.width);
  const height = Math.max(200, size.height);
  const plotW = width - ML - MR;
  const plotH = height - MT - MB;
  const maxLap = Math.max(1, ...withData.flatMap((s) => s.points.map((p) => p[0])));
  const minLap = kind === "position" ? 0 : Math.min(...withData.flatMap((s) => s.points.map((p) => p[0])));
  const nCars = Math.max(...withData.flatMap((s) => s.points.map((p) => p[1])), withData.length);
  const visible = focus.size ? withData.filter((s) => focus.has(s.num)) : withData;
  const gapMax =
    kind === "gap"
      ? props.range || Math.max(1, ...visible.flatMap((s) => s.points.map((p) => p[1])))
      : 0;
  const yMax = kind === "position" ? nCars : gapMax;
  const yMin = kind === "position" ? 1 : 0;

  const x = (lap: number) => ML + ((lap - minLap) / Math.max(1, maxLap - minLap)) * plotW;
  const y = (v: number) => MT + ((v - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;
  const clipId = `clip-${kind}`;

  const lapTicks = niceTicks(minLap, maxLap, Math.max(2, Math.floor(plotW / 70)));
  const yTicks = kind === "position" ? [1, 5, 10, 15, 20].filter((p) => p <= nCars) : niceTicks(0, yMax, 5);

  // Draw dimmed lines first, focused/all on top.
  const ordered = [...withData].sort((s, t) => Number(isOn(s)) - Number(isOn(t)));
  function isOn(s: DriverSeries) {
    return !focus.size || focus.has(s.num);
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const lap = Math.round(minLap + ((e.clientX - r.left - ML) / plotW) * (maxLap - minLap));
    setHoverLap(lap >= minLap && lap <= maxLap ? lap : null);
  };

  const tip =
    hoverLap == null
      ? []
      : visible
          .map((s) => ({ s, v: s.points.find((p) => p[0] === hoverLap)?.[1] }))
          .filter((r): r is { s: DriverSeries; v: number } => r.v != null)
          .sort((p, q) => p.v - q.v);
  const showLabels = kind === "position" || visible.length <= 8;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHoverLap(null)}>
        <defs>
          <clipPath id={clipId}>
            {/* a little headroom so 2px lines at the edges aren't cut in half */}
            <rect x={ML - 2} y={MT - 3} width={plotW + 4} height={plotH + 6} />
          </clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={ML} x2={ML + plotW} y1={y(t)} y2={y(t)} className="grid" />
            <text x={ML - 6} y={y(t) + 3} className="axis-label" textAnchor="end">
              {kind === "position" ? `P${t}` : `${t}s`}
            </text>
          </g>
        ))}
        {lapTicks.map((t) => (
          <text key={t} x={x(t)} y={height - 6} className="axis-label" textAnchor="middle">
            {t === 0 && kind === "position" ? "GRID" : `L${t}`}
          </text>
        ))}
        {ordered.map((s) => {
          const on = isOn(s);
          const pts = s.points;
          const d = `M${pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("L")}`;
          const last = s.points.at(-1)!;
          return (
            <g key={s.num} className={on ? "" : "series-dim"} onClick={() => props.onToggle(s.num)}>
              <path d={d} className="series-hit" clipPath={`url(#${clipId})`} />
              <path
                clipPath={`url(#${clipId})`}
                d={d}
                stroke={on ? s.color : "var(--line-strong)"}
                strokeDasharray={s.dashed ? "5 3" : undefined}
                className="series"
              />
              {on && showLabels && last[1] <= yMax && (
                <text x={x(last[0]) + 5} y={y(last[1]) + 3} className="end-label">
                  {s.tla}
                </text>
              )}
            </g>
          );
        })}
        {hoverLap != null && <line x1={x(hoverLap)} x2={x(hoverLap)} y1={MT} y2={MT + plotH} className="crosshair" />}
      </svg>
      {hoverLap != null && tip.length > 0 && (
        <div
          className="tooltip tooltip-list"
          style={{ left: x(hoverLap) > width / 2 ? x(hoverLap) - 172 : x(hoverLap) + 12, top: MT }}
        >
          <div className="tt-head">{hoverLap === 0 && kind === "position" ? "GRID" : `LAP ${hoverLap}`}</div>
          {tip.map(({ s, v }) => (
            <div key={s.num} className="tt-row">
              <svg width="12" height="6">
                <line x1="0" x2="12" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
              </svg>
              <b>{kind === "position" ? `P${v}` : v === 0 ? "LEADER" : `+${v.toFixed(1)}s`}</b>
              <span className="dim">{s.tla}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = Math.max(1, hi - lo);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

import { useMemo, useState } from "react";
import type { Driver, LapInfo, LapTrace } from "../../../shared/types.ts";
import type { Row } from "../derive.ts";
import { fmtLap } from "../format.ts";
import { useJson, useSize } from "../hooks.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";
import { SLOT_A, SLOT_B } from "./TrackView.tsx";

type LapPick = "fastest" | "last" | number;

interface Props {
  rows: Row[];
  a: string;
  b: string;
  setA: (n: string) => void;
  setB: (n: string) => void;
}

export function TelemetryPanel({ rows, a, b, setA, setB }: Props) {
  const [lapA, setLapA] = useState<LapPick>("fastest");
  const [lapB, setLapB] = useState<LapPick>("fastest");
  const sideA = useSide(rows, a, lapA);
  const sideB = useSide(rows, b, lapB);

  return (
    <div className="telemetry">
      <Panel title="LIVE TELEMETRY" className="gauges-panel">
        <div className="gauges">
          <Gauges num={a} color={SLOT_A} rows={rows} onPick={setA} slot="A" />
          <Gauges num={b} color={SLOT_B} rows={rows} onPick={setB} slot="B" />
        </div>
      </Panel>
      <Panel
        title="LAP COMPARE"
        className="compare-panel"
        right={
          <span className="lap-picks">
            <LapSelect color={SLOT_A} laps={sideA.laps} value={lapA} onChange={setLapA} />
            <span className="dim">vs</span>
            <LapSelect color={SLOT_B} laps={sideB.laps} value={lapB} onChange={setLapB} />
          </span>
        }
      >
        <CompareCharts a={sideA} b={sideB} />
      </Panel>
    </div>
  );
}

interface Side {
  num: string;
  tla: string;
  laps: LapInfo[];
  trace: LapTrace | null;
}

function useSide(rows: Row[], num: string, pick: LapPick): Side {
  const row = rows.find((r) => r.num === num);
  // Refetch the lap list whenever this car completes a lap.
  const laps = useJson<LapInfo[]>(num ? `/api/replay/laps?num=${num}` : null, `${num}:${row?.laps}`) ?? [];
  const lap =
    pick === "fastest"
      ? laps.reduce<LapInfo | null>((best, l) => (!best || l.time < best.time ? l : best), null)?.lap
      : pick === "last"
        ? laps.at(-1)?.lap
        : pick;
  const trace = useJson<LapTrace>(num && lap ? `/api/replay/trace?num=${num}&lap=${lap}` : null);
  return { num, tla: row?.tla ?? num, laps, trace: trace?.num === num ? trace : null };
}

function LapSelect(props: { color: string; laps: LapInfo[]; value: LapPick; onChange: (v: LapPick) => void }) {
  return (
    <select
      className="sel"
      style={{ borderColor: props.color }}
      value={String(props.value)}
      onChange={(e) => {
        const v = e.target.value;
        props.onChange(v === "fastest" || v === "last" ? v : Number(v));
      }}
    >
      <option value="fastest">FASTEST LAP</option>
      <option value="last">LAST LAP</option>
      {props.laps
        .slice()
        .reverse()
        .map((l) => (
          <option key={l.lap} value={l.lap}>
            LAP {l.lap} · {fmtLap(l.time)}
          </option>
        ))}
    </select>
  );
}

function Gauges(props: { num: string; color: string; rows: Row[]; onPick: (n: string) => void; slot: string }) {
  const car = useStore((s) => (s.feed.CarData?.Cars as Record<string, number[]> | undefined)?.[props.num]);
  const driver = useStore((s) => (s.feed.DriverList as Record<string, Driver> | undefined)?.[props.num]);
  const [rpm = 0, speed = 0, gear = 0, throttle = 0, brake = 0] = car ?? [];
  const row = props.rows.find((r) => r.num === props.num);
  return (
    <div className="gauge" style={{ borderColor: props.color }}>
      <div className="gauge-head">
        <span className="slot" style={{ background: props.color }}>
          {props.slot}
        </span>
        <select className="sel" value={props.num} onChange={(e) => props.onPick(e.target.value)}>
          {props.rows.map((r) => (
            <option key={r.num} value={r.num}>
              P{r.line} {r.tla}
            </option>
          ))}
        </select>
        <i className="team" style={{ background: `#${driver?.TeamColour ?? "666"}` }} />
        <span className="dim">{row ? `P${row.line}` : ""}</span>
      </div>
      <div className="gauge-main">
        <div>
          <div className="g-speed">{car ? speed : "—"}</div>
          <div className="g-unit">KM/H</div>
        </div>
        <div>
          <div className="g-gear">{car ? (gear >= 1 && gear <= 8 ? gear : "N") : "—"}</div>
          <div className="g-unit">GEAR</div>
        </div>
      </div>
      <Bar label="RPM" value={rpm / 13000} text={car ? String(rpm) : ""} cls="bar-rpm" />
      <Bar label="THR" value={throttle / 100} text={car ? `${Math.min(100, throttle)}%` : ""} cls="bar-thr" />
      <Bar label="BRK" value={brake ? 1 : 0} text={brake ? "ON" : ""} cls="bar-brk" />
    </div>
  );
}

function Bar({ label, value, text, cls }: { label: string; value: number; text: string; cls: string }) {
  return (
    <div className="g-bar">
      <span className="g-unit">{label}</span>
      <span className="g-track">
        <i className={cls} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      <span className="g-val">{text}</span>
    </div>
  );
}

// ---------- lap comparison ----------

interface Series {
  d: number[];
  t: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
}

/** Scale distance to a common lap length so the two traces line up despite integration drift. */
function toSeries(trace: LapTrace, length: number): Series {
  const total = trace.points.at(-1)?.d || 1;
  const k = length / total;
  return {
    d: trace.points.map((p) => p.d * k),
    t: trace.points.map((p) => p.t),
    speed: trace.points.map((p) => p.speed),
    throttle: trace.points.map((p) => Math.min(100, p.throttle)),
    brake: trace.points.map((p) => p.brake),
    gear: trace.points.map((p) => p.gear),
  };
}

/** Index of the last sample with d <= x. */
function at(d: number[], x: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (d[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function interp(d: number[], v: number[], x: number): number {
  const i = at(d, x);
  const j = Math.min(i + 1, d.length - 1);
  const span = d[j]! - d[i]!;
  const f = span > 0 ? Math.max(0, Math.min(1, (x - d[i]!) / span)) : 0;
  return v[i]! + (v[j]! - v[i]!) * f;
}

const ML = 46;
const MR = 12;
const PANELS = [
  { key: "speed", label: "SPEED km/h", h: 150 },
  { key: "delta", label: "Δ TIME s", h: 72 },
  { key: "throttle", label: "THROTTLE %", h: 56 },
  { key: "brake", label: "BRAKE", h: 22 },
  { key: "gear", label: "GEAR", h: 56 },
] as const;
const GAP = 14;
const AXIS = 22;

function CompareCharts({ a, b }: { a: Side; b: Side }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    if (!a.trace?.points.length || !b.trace?.points.length) return null;
    const length = ((a.trace.points.at(-1)!.d + b.trace.points.at(-1)!.d) / 2) | 0;
    const sa = toSeries(a.trace, length);
    const sb = toSeries(b.trace, length);
    // Delta: B's time minus A's time at the same distance (positive = B slower). Sample timing
    // drifts slightly vs the official lap times, so spread the error linearly over the lap
    // to make the delta end exactly at the real lap-time difference.
    const raw = sa.d.map((x, i) => interp(sb.d, sb.t, x) - sa.t[i]!);
    const drift = b.trace.time - a.trace.time - (raw.at(-1) ?? 0);
    const delta = raw.map((v, i) => v + (sa.d[i]! / length) * drift);
    return { length, sa, sb, delta };
  }, [a.trace, b.trace]);

  if (!a.trace || !b.trace || !data) {
    return (
      <div className="compare" ref={ref}>
        <div className="empty">{a.laps.length && b.laps.length ? "LOADING LAP TRACES…" : "WAITING FOR COMPLETED LAPS…"}</div>
      </div>
    );
  }

  const width = Math.max(320, size.width);
  const plotW = width - ML - MR;
  const x = (d: number) => ML + (d / data.length) * plotW;
  let y0 = GAP;
  const panels = PANELS.map((p) => {
    const top = y0;
    y0 += p.h + GAP;
    return { ...p, top };
  });
  const height = y0 - GAP + AXIS;

  const speedMax = Math.max(...data.sa.speed, ...data.sb.speed) + 10;
  const speedMin = Math.max(0, Math.min(...data.sa.speed, ...data.sb.speed) - 10);
  const dAbs = Math.max(0.1, ...data.delta.map(Math.abs));
  const domain: Record<string, [number, number]> = {
    speed: [speedMin, speedMax],
    delta: [-dAbs, dAbs],
    throttle: [0, 100],
    brake: [0, 100],
    gear: [0, 8],
  };
  const yOf = (p: (typeof panels)[number], v: number) => {
    const [lo, hi] = domain[p.key]!;
    return p.top + p.h - ((v - lo) / (hi - lo)) * p.h;
  };
  const path = (p: (typeof panels)[number], d: number[], v: number[], step = false) => {
    let s = "";
    for (let i = 0; i < d.length; i++) {
      const px = x(d[i]!).toFixed(1);
      const py = yOf(p, v[i]!).toFixed(1);
      if (i === 0) s += `M${px},${py}`;
      else if (step) s += `H${px}V${py}`;
      else s += `L${px},${py}`;
    }
    return s;
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = ((e.clientX - r.left - ML) / plotW) * data.length;
    setHover(d >= 0 && d <= data.length ? d : null);
  };

  const ticks = Array.from({ length: Math.floor(data.length / 1000) + 1 }, (_, i) => i * 1000);
  const hv = hover == null ? null : {
    a: { speed: interp(data.sa.d, data.sa.speed, hover), thr: interp(data.sa.d, data.sa.throttle, hover), gear: data.sa.gear[at(data.sa.d, hover)] },
    b: { speed: interp(data.sb.d, data.sb.speed, hover), thr: interp(data.sb.d, data.sb.throttle, hover), gear: data.sb.gear[at(data.sb.d, hover)] },
    delta: interp(data.sa.d, data.delta, hover),
  };
  const total = b.trace.time - a.trace.time;

  return (
    <div className="compare" ref={ref}>
      <div className="compare-legend">
        <LegendItem color={SLOT_A} text={`${a.tla} · LAP ${a.trace.lap} · ${fmtLap(a.trace.time)}`} />
        <LegendItem color={SLOT_B} text={`${b.tla} · LAP ${b.trace.lap} · ${fmtLap(b.trace.time)}`} dashed />
        <span className="dim">
          Δ at line:{" "}
          <span className="c-white">
            {b.tla} {total >= 0 ? "+" : ""}
            {total.toFixed(3)}s
          </span>
        </span>
      </div>
      <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="compare-svg">
        {panels.map((p) => (
          <g key={p.key}>
            <rect x={ML} y={p.top} width={plotW} height={p.h} className="plot-bg" />
            <text x={ML - 6} y={p.top + 9} className="axis-label" textAnchor="end">
              {p.key === "speed" ? Math.round(speedMax) : p.key === "delta" ? `+${dAbs.toFixed(1)}` : p.key === "gear" ? 8 : p.key === "throttle" ? 100 : ""}
            </text>
            <text x={ML - 6} y={p.top + p.h} className="axis-label" textAnchor="end">
              {p.key === "speed" ? Math.round(speedMin) : p.key === "delta" ? `-${dAbs.toFixed(1)}` : p.key === "brake" ? "" : 0}
            </text>
            <text x={ML} y={p.top - 4} className="panel-label">
              {p.label}
            </text>
            {p.key === "delta" && <line x1={ML} x2={ML + plotW} y1={yOf(p, 0)} y2={yOf(p, 0)} className="zero-line" />}
            {p.key === "delta" ? (
              <path d={path(p, data.sa.d, data.delta)} stroke={SLOT_B} className="trace" />
            ) : p.key === "brake" ? (
              <>
                <BrakeBand d={data.sa.d} v={data.sa.brake} x={x} y={p.top + 1} h={p.h / 2 - 2} color={SLOT_A} />
                <BrakeBand d={data.sb.d} v={data.sb.brake} x={x} y={p.top + p.h / 2 + 1} h={p.h / 2 - 2} color={SLOT_B} />
              </>
            ) : (
              <>
                <path d={path(p, data.sa.d, data.sa[p.key], p.key === "gear")} stroke={SLOT_A} className="trace" />
                <path d={path(p, data.sb.d, data.sb[p.key], p.key === "gear")} stroke={SLOT_B} className="trace trace-b" />
              </>
            )}
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={height - 6} className="axis-label" textAnchor="middle">
            {t / 1000}km
          </text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height - AXIS} className="crosshair" />}
      </svg>
      {hv && hover != null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 12, width - 190), top: 30 }}>
          <div className="tt-head">{(hover / 1000).toFixed(2)} km</div>
          <TipRow color={SLOT_A} tla={a.tla} v={hv.a} />
          <TipRow color={SLOT_B} tla={b.tla} v={hv.b} dashed />
          <div className="tt-row">
            <b>
              {hv.delta >= 0 ? "+" : ""}
              {hv.delta.toFixed(3)}s
            </b>
            <span className="dim">{b.tla} vs {a.tla}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function BrakeBand(props: { d: number[]; v: number[]; x: (d: number) => number; y: number; h: number; color: string }) {
  const rects: [number, number][] = [];
  let start: number | null = null;
  props.v.forEach((v, i) => {
    if (v && start == null) start = props.d[i]!;
    if (!v && start != null) {
      rects.push([start, props.d[i]!]);
      start = null;
    }
  });
  if (start != null) rects.push([start, props.d.at(-1)!]);
  return (
    <>
      {rects.map(([s, e], i) => (
        <rect key={i} x={props.x(s)} y={props.y} width={Math.max(1, props.x(e) - props.x(s))} height={props.h} fill={props.color} rx={1} />
      ))}
    </>
  );
}

function LegendItem({ color, text, dashed }: { color: string; text: string; dashed?: boolean }) {
  return (
    <span className="legend-item">
      <svg width="18" height="6">
        <line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      {text}
    </span>
  );
}

function TipRow({ color, tla, v, dashed }: { color: string; tla: string; v: { speed: number; thr: number; gear?: number }; dashed?: boolean }) {
  return (
    <div className="tt-row">
      <svg width="12" height="6">
        <line x1="0" x2="12" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} />
      </svg>
      <b>{Math.round(v.speed)}</b>
      <span className="dim">
        km/h · {Math.round(v.thr)}% · G{v.gear ?? "-"} · {tla}
      </span>
    </div>
  );
}

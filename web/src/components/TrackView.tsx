import { useEffect, useMemo, useState } from "react";
import type { Driver, SessionInfo, TrackOutline } from "../../../shared/types.ts";
import { flagState } from "../flags.ts";
import type { Row } from "../derive.ts";
import { useJson } from "../hooks.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";
import { TelemetryPanel } from "./TelemetryPanel.tsx";

export const SLOT_A = "#d9730d";
export const SLOT_B = "#3d8bff";

export function TrackView({ rows }: { rows: Row[] }) {
  const source = useStore((s) => s.source);
  const replay = useStore((s) => s.replay);
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  // Default comparison: the top two in the running order.
  useEffect(() => {
    if (!rows.length) return;
    if (!a || !rows.some((r) => r.num === a)) setA(rows[0]!.num);
    if (!b || !rows.some((r) => r.num === b)) setB(rows[1]?.num ?? rows[0]!.num);
  }, [rows, a, b]);

  const meta = useStore((s) => s.feed.TrackMeta) as { mode?: string; from?: string } | undefined;

  if (source !== "replay") {
    if (meta?.mode !== "estimated") {
      return (
        <main className="main main-single">
          <div className="notice">
            <div className="c-amber">▌LIVE TRACK MAP</div>
            <p>
              {meta?.mode === "unavailable"
                ? "No archived session at this circuit to calibrate from yet, so live positions can't be estimated. Replays still have the full GPS map."
                : "Calibrating from an archived session at this circuit…"}
            </p>
          </div>
        </main>
      );
    }
    return (
      <main className="main main-single-map">
        <TrackMap a="" b="" onPick={() => {}} ready sourceKey={`live:${meta.from}`} estimated />
      </main>
    );
  }

  return (
    <main className="main main-track">
      <TrackMap
        a={a}
        b={b}
        onPick={setA}
        ready={replay?.telemetry === "ready"}
        sourceKey={`replay:${replay?.path}`}
        status={replay?.telemetry}
      />
      <TelemetryPanel rows={rows} a={a} b={b} setA={setA} setB={setB} />
    </main>
  );
}

const PAD = 400; // track units (1/10 m)

interface CircuitInfo {
  marshalSectors: { number: number; x: number; y: number }[];
  corners: { number: number; x: number; y: number; angle?: number }[];
}

function TrackMap(props: {
  a: string;
  b: string;
  onPick: (n: string) => void;
  ready: boolean;
  sourceKey: string;
  status?: string;
  estimated?: boolean;
}) {
  const outline = useJson<TrackOutline>(props.ready ? "/api/track" : null, props.sourceKey);
  const position = useStore((s) => s.feed.Position) as { Entries?: Record<string, [number, number, number]> } | undefined;
  const drivers = useStore((s) => s.feed.DriverList) as Record<string, Driver> | undefined;
  const lines = useStore((s) => s.feed.TimingData?.Lines) as Record<string, { Line?: number }> | undefined;
  const speed = useStore((s) => s.replay?.speed ?? 1);

  const geo = useMemo(() => {
    if (!outline) return null;
    const cos = Math.cos(-outline.rotation);
    const sin = Math.sin(-outline.rotation);
    // Rotate the main axis horizontal; SVG y grows downwards.
    const tf = (x: number, y: number): [number, number] => [x * cos - y * sin, -(x * sin + y * cos)];
    const pts = outline.points.map(([x, y]) => tf(x, y));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs) - PAD;
    const minY = Math.min(...ys) - PAD;
    const w = Math.max(...xs) - minX + PAD;
    const h = Math.max(...ys) - minY + PAD;
    const d = `M${pts.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join("L")}Z`;
    // Arc length along the (closed) outline, to draw stretches of track between two points.
    const cum = [0];
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i % pts.length]!;
      cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const length = cum.at(-1)!;
    const project = (x: number, y: number) => {
      let best = Infinity;
      let bi = 0;
      pts.forEach((p, i) => {
        const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (dd < best) {
          best = dd;
          bi = i;
        }
      });
      return cum[bi]!;
    };
    /** SVG path along the outline from arc length s0 to s1 (wrapping past the line). */
    const stretch = (s0: number, s1: number) => {
      const out: [number, number][] = [];
      const end = s1 > s0 ? s1 : s1 + length;
      for (let i = 0; i < pts.length * 2; i++) {
        const s = cum[i % pts.length]! + (i >= pts.length ? length : 0);
        if (s >= s0 && s <= end) out.push(pts[i % pts.length]!);
      }
      return out.length > 1 ? `M${out.map((p) => `${p[0].toFixed(0)},${p[1].toFixed(0)}`).join("L")}` : "";
    };
    const pointAt = (s: number): [number, number] => {
      s = ((s % length) + length) % length;
      let i = 0;
      while (i < pts.length - 1 && cum[i + 1]! <= s) i++;
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const f = (s - cum[i]!) / Math.max(1e-9, cum[i + 1]! - cum[i]!);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    return { tf, viewBox: `${minX} ${minY} ${w} ${h}`, d, start: pts[0]!, unit: Math.max(w, h) / 100, project, stretch, pointAt, length };
  }, [outline]);

  // Marshal sectors & corner numbers (not in F1's feed; see /api/circuit).
  const info = useStore((s) => s.feed.SessionInfo) as SessionInfo | undefined;
  const circuitKey = info?.Meeting?.Circuit?.Key;
  const year = Number((info?.Path ?? "").slice(0, 4)) || new Date().getUTCFullYear();
  const circuit = useJson<CircuitInfo>(circuitKey ? `/api/circuit?key=${circuitKey}&year=${year}` : null);
  const rcm = useStore((s) => s.feed.RaceControlMessages?.Messages);
  const trackStatus = useStore((s) => s.feed.TrackStatus?.Status) as string | undefined;
  const flags = flagState(rcm, trackStatus);

  const marshal = useMemo(() => {
    if (!geo || !circuit?.marshalSectors?.length) return [];
    const sorted = circuit.marshalSectors.slice().sort((a, b) => a.number - b.number);
    const starts = sorted.map((m) => geo.project(...geo.tf(m.x, m.y)));
    return sorted.map((m, i) => {
      const s0 = starts[i]!;
      const s1 = starts[(i + 1) % starts.length]!;
      const mid = s1 > s0 ? (s0 + s1) / 2 : ((s0 + s1 + geo.length) / 2) % geo.length;
      return { number: m.number, d: geo.stretch(s0, s1), mid };
    });
  }, [geo, circuit]);

  const all = Object.entries(position?.Entries ?? {}).filter(([num]) => drivers?.[num]);
  const inPit = all.filter(([, p]) => p[2] === 2).map(([num]) => num);
  const cars = all
    .filter(([, p]) => p[2] !== 2)
    .sort(([x], [y]) => (lines?.[y]?.Line ?? 99) - (lines?.[x]?.Line ?? 99)); // leader drawn last (on top)
  const dur = Math.max(60, Math.min(300, 250 / speed));

  return (
    <Panel
      title="TRACK MAP"
      className="trackmap"
      right={
        props.estimated ? (
          <span className="c-amber" title="F1 sends live GPS only to F1 TV; positions are placed from mini-sector times">
            ◆ ESTIMATED FROM MINI-SECTORS · ~20–80 M
          </span>
        ) : (
          <span className="dim">CLICK A CAR TO COMPARE IT (A)</span>
        )
      }
    >
      {!geo ? (
        <div className="empty">
          {props.status === "none" ? "NO POSITION DATA IN THIS ARCHIVE" : "LOADING POSITION DATA… (FIRST LOAD OF A SESSION CAN TAKE ~30 S)"}
        </div>
      ) : (
        <svg className="map" viewBox={geo.viewBox} preserveAspectRatio="xMidYMid meet" style={{ ["--dur" as string]: `${dur}ms` }}>
          <path d={geo.d} className="map-track-outer" style={{ strokeWidth: geo.unit * 2.2 }} />
          <path d={geo.d} className="map-track" style={{ strokeWidth: geo.unit * 1.1 }} />
          {flags.red && <path d={geo.d} className="flag-red" style={{ strokeWidth: geo.unit * 1.1 }} />}
          {marshal.map((m) => {
            const flag = flags.sectors.get(m.number);
            if (!flag || !m.d) return null;
            const double = flag === "DOUBLE YELLOW";
            return (
              <g key={m.number} className={double ? "flag-double" : "flag-single"}>
                <path d={m.d} className="flag-yellow" style={{ strokeWidth: geo.unit * (double ? 1.6 : 1.2) }} />
                {double && <path d={m.d} className="flag-stripes" style={{ strokeWidth: geo.unit * 1.6, strokeDasharray: `${geo.unit} ${geo.unit}` }} />}
              </g>
            );
          })}
          {circuit?.corners?.map((c) => {
            const a = ((c.angle ?? 0) * Math.PI) / 180;
            const off = geo.unit * 3; // ~30 m off the racing line, in the direction MultiViewer gives
            const [lx, ly] = geo.tf(c.x + Math.cos(a) * off, c.y + Math.sin(a) * off);
            return (
              <text key={c.number} x={lx} y={ly + geo.unit * 0.6} fontSize={geo.unit * 1.7} textAnchor="middle" className="corner-label">
                {c.number}
              </text>
            );
          })}
          {marshal.map((m) => {
            const flag = flags.sectors.get(m.number);
            if (!flag) return null;
            // Label the flagged stretch with its sector number, just above its midpoint.
            const [tx, ty] = geo.pointAt(m.mid);
            return (
              <g key={`l${m.number}`} transform={`translate(${tx} ${ty})`}>
                <rect x={-geo.unit * 2.6} y={-geo.unit * 4.2} width={geo.unit * 5.2} height={geo.unit * 2.4} className="flag-tag" />
                <text y={-geo.unit * 2.4} fontSize={geo.unit * 1.7} textAnchor="middle" className="flag-tag-text">
                  {flag === "DOUBLE YELLOW" ? "YY" : "Y"} {m.number}
                </text>
              </g>
            );
          })}
          <g transform={`translate(${geo.start[0]} ${geo.start[1]})`}>
            <rect x={-geo.unit * 0.35} y={-geo.unit * 1.6} width={geo.unit * 0.7} height={geo.unit * 3.2} className="map-start" />
            <text y={-geo.unit * 2.2} fontSize={geo.unit * 2} textAnchor="middle" className="map-start-label">
              S/F
            </text>
          </g>
          {cars.map(([num, [x, y, on]]) => {
            const [px, py] = geo.tf(x, y);
            const d = drivers![num]!;
            const slot = num === props.a ? SLOT_A : num === props.b ? SLOT_B : null;
            const r = geo.unit * (slot ? 1.5 : 1.1);
            return (
              <g
                key={num}
                className={`car ${on ? "" : "car-off"}`}
                style={{ transform: `translate(${px}px, ${py}px)` }}
                onClick={() => props.onPick(num)}
              >
                {slot && <circle r={r + geo.unit * 0.7} fill="none" stroke={slot} strokeWidth={geo.unit * 0.45} />}
                <circle r={r} fill={`#${d.TeamColour ?? "888"}`} stroke="var(--bg)" strokeWidth={geo.unit * 0.3} />
                <text x={r + geo.unit * 0.8} y={geo.unit * 0.9} fontSize={geo.unit * 2.6} className="car-label">
                  {d.Tla}
                </text>
                <circle r={geo.unit * 4} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
      {geo && inPit.length > 0 && (
        <div className="pitbox">
          <div className="tb-label">PIT LANE</div>
          {inPit.map((num) => (
            <div key={num} className="pit-car">
              <i className="team" style={{ background: `#${drivers?.[num]?.TeamColour ?? "666"}` }} />
              {drivers?.[num]?.Tla}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

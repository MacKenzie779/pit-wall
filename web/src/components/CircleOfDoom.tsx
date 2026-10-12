import { useMemo, useState } from "react";
import type { Row } from "../derive.ts";
import { fmtLap } from "../format.ts";
import { useSize } from "../hooks.ts";
import { mod, raceTimes, referenceLap, rejoin, type Neighbour, type Rejoin } from "../pitwindow.ts";

interface Car {
  row: Row;
  t: number; // race time behind the leader
  angle: number; // radians clockwise from the top
  rejoin: Rejoin | null;
}

const LABEL_W = 24;
const LABEL_H = 11;
const LANES = 4;

/**
 * "Circle of doom": the field drawn round one lap by time behind the leader, so lapped cars
 * sit next to the cars they're racing on the road. Focused cars get a ghost where they would
 * rejoin after a stop that costs `loss` seconds.
 */
export function CircleOfDoom(props: {
  rows: Row[];
  focus: Set<string>;
  loss: number;
  underSafetyCar: boolean;
  onToggle: (num: string) => void;
}) {
  const { rows, focus, loss } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const lap = referenceLap(rows);
  const cars: Car[] = useMemo(() => {
    if (!lap) return [];
    const times = raceTimes(rows);
    return rows
      .filter((r) => times.has(r.num))
      .map((row) => {
        const t = times.get(row.num)!;
        return { row, t, angle: (mod(t, lap) / lap) * 2 * Math.PI, rejoin: rejoin(times, row.num, loss, lap) };
      });
  }, [rows, lap, loss]);
  const byNum = new Map(cars.map((c) => [c.row.num, c]));

  if (!lap || cars.length < 2) {
    return (
      <div className="chart-wrap" ref={ref}>
        <div className="empty">WAITING FOR GAPS AND LAP TIMES…</div>
      </div>
    );
  }

  const side = Math.max(260, Math.min(size.width, size.height));
  const cx = Math.max(side, size.width) / 2;
  const cy = side / 2;
  const R = side / 2 - 18 - LANES * 13;
  const at = (angle: number, r: number) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)] as const;
  const angleOf = (t: number) => (mod(t, lap) / lap) * 2 * Math.PI;

  // Labels go on the outermost free lane so clustered cars don't overprint each other.
  const placed: { x: number; y: number }[] = [];
  const labels = [...cars]
    .sort((a, b) => a.angle - b.angle)
    .map((c) => {
      let lane = 0;
      let x = 0;
      let y = 0;
      for (; lane < LANES; lane++) {
        [x, y] = at(c.angle, R + 16 + lane * 13);
        const bx = x;
        const by = y;
        if (!placed.some((p) => Math.abs(p.x - bx) < LABEL_W + 2 && Math.abs(p.y - by) < LABEL_H)) break;
      }
      lane = Math.min(lane, LANES - 1);
      [x, y] = at(c.angle, R + 16 + lane * 13);
      placed.push({ x, y });
      return { c, lane, x, y };
    });

  const maxLabels = R < 140 ? 6 : 12;
  const tickStep = [5, 10, 15, 20, 30].find((s) => lap / s <= maxLabels) ?? 30;
  const ticks: number[] = [];
  for (let s = 0; s < lap - 0.5; s += tickStep / 2) ticks.push(s);

  const ghosts = cars.filter((c) => focus.has(c.row.num) && c.rejoin);
  const hovered = hover ? byNum.get(hover) : null;

  return (
    <div className="doom">
      <div className="chart-wrap" ref={ref}>
        <svg width={size.width} height={side}>
          <circle cx={cx} cy={cy} r={R} className="doom-ring" />
          {ticks.map((s) => {
            const major = s % tickStep === 0;
            const [x1, y1] = at(angleOf(s), R - (major ? 7 : 4));
            const [x2, y2] = at(angleOf(s), R);
            const [lx, ly] = at(angleOf(s), R - 18);
            return (
              <g key={s}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className="doom-tick" />
                {major && (s === 0 || s < lap - tickStep / 2) && (
                  <text x={lx} y={ly + 3} className="axis-label" textAnchor="middle">
                    {s === 0 ? "0" : `${s}s`}
                  </text>
                )}
              </g>
            );
          })}

          {/* pit loss as an arc from the car to its rejoin point, one inner lane per car */}
          {ghosts.map((c, i) => {
            const r = R - 30 - i * 7;
            if (r < 20) return null;
            const end = angleOf(c.rejoin!.t);
            const [x1, y1] = at(c.angle, r);
            const [x2, y2] = at(end, r);
            const large = mod(end - c.angle, 2 * Math.PI) > Math.PI ? 1 : 0;
            const [gx, gy] = at(end, R);
            const [sx, sy] = at(end, r);
            return (
              <g key={c.row.num} className="doom-ghost">
                <path d={`M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`} stroke={c.row.color} className="doom-arc" />
                <line x1={sx} y1={sy} x2={gx} y2={gy} stroke={c.row.color} className="doom-spoke" />
                <circle cx={gx} cy={gy} r={7} stroke={c.row.color} className="doom-ghost-dot" />
              </g>
            );
          })}

          {labels.map(({ c, lane, x, y }) => {
            const [dx, dy] = at(c.angle, R);
            const [lx, ly] = at(c.angle, R + 16 + lane * 13 - 6);
            const sin = Math.sin(c.angle);
            const anchor = sin > 0.25 ? "start" : sin < -0.25 ? "end" : "middle";
            const on = focus.has(c.row.num);
            const pit = c.row.status === "PIT" || c.row.status === "OUT";
            return (
              <g
                key={c.row.num}
                className="doom-car"
                onClick={() => props.onToggle(c.row.num)}
                onPointerEnter={() => setHover(c.row.num)}
                onPointerLeave={() => setHover((h) => (h === c.row.num ? null : h))}
              >
                {lane > 0 && <line x1={dx} y1={dy} x2={lx} y2={ly} className="doom-leader" />}
                <circle cx={dx} cy={dy} r={14} className="series-hit" />
                {on && <circle cx={dx} cy={dy} r={9.5} className="doom-focus" />}
                <circle
                  cx={dx}
                  cy={dy}
                  r={6}
                  fill={pit ? "var(--panel)" : c.row.color}
                  stroke={pit ? c.row.color : "var(--panel)"}
                  className="doom-dot"
                />
                <text x={x} y={y + 3.5} textAnchor={anchor} className={`end-label ${on ? "c-amber" : ""}`}>
                  {c.row.tla}
                </text>
              </g>
            );
          })}

          <text x={cx} y={cy - 8} textAnchor="middle" className="panel-label">
            LAP {fmtLap(lap)}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" className="panel-label">
            PIT LOSS {loss.toFixed(1)}s
          </text>
        </svg>
        {hovered && <DoomTip car={hovered} byNum={byNum} x={at(hovered.angle, R)} width={size.width} />}
      </div>
      <div className="doom-readout">
        {ghosts.length === 0 ? (
          <div className="dim">CLICK A CAR OR A FOCUS CHIP TO SEE WHERE IT WOULD REJOIN AFTER A STOP</div>
        ) : (
          ghosts.map((c) => <RejoinLine key={c.row.num} car={c} byNum={byNum} />)
        )}
        {props.underSafetyCar && ghosts.length > 0 && (
          <div className="c-yellow">SC / VSC: A STOP COSTS LESS THAN THE GREEN-FLAG PIT LOSS</div>
        )}
      </div>
    </div>
  );
}

function RejoinLine({ car, byNum }: { car: Car; byNum: Map<string, Car> }) {
  const rj = car.rejoin!;
  return (
    <div className="doom-line">
      <i style={{ background: car.row.color }} />
      <b className="c-white">{car.row.tla}</b>
      <span>
        P{car.row.line} → <b className={rj.pos > car.row.line ? "c-amber" : "c-white"}>P{rj.pos}</b>
      </span>
      <span className="dim2">
        {neighbour(rj.ahead, "behind", byNum)}
        {rj.ahead && rj.behind && " · "}
        {neighbour(rj.behind, "ahead of", byNum)}
      </span>
    </div>
  );
}

/** "1.3s behind NOR" — `behind` describes the car in front, from the rejoining car's view. */
function neighbour(n: Neighbour | null, word: string, byNum: Map<string, Car>) {
  if (!n) return null;
  const other = byNum.get(n.num)?.row;
  const tag = n.lapped ? (word === "behind" ? " (LAPPED)" : " (LAPPING)") : "";
  return (
    <>
      <span className={n.gap < 1 ? "c-red" : n.gap < 2 ? "c-yellow" : ""}>{n.gap.toFixed(1)}s</span> {word}{" "}
      {other?.tla ?? n.num}
      {tag}
    </>
  );
}

function DoomTip({ car, byNum, x, width }: { car: Car; byNum: Map<string, Car>; x: readonly [number, number]; width: number }) {
  const r = car.row;
  return (
    <div className="tooltip" style={{ left: x[0] > width / 2 ? x[0] - 190 : x[0] + 16, top: Math.max(4, x[1] - 20) }}>
      <div className="tt-head">
        P{r.line} {r.tla}
      </div>
      <div className="tt-row">
        <span className="dim">GAP</span> <b>{r.line === 1 ? "LEADER" : `+${car.t.toFixed(1)}s`}</b>
        {r.status && <span className="c-amber">{r.status}</span>}
      </div>
      {car.rejoin && (
        <>
          <div className="tt-row">
            <span className="dim">PIT NOW</span> <b>P{car.rejoin.pos}</b>
          </div>
          <div className="tt-row dim2">{neighbour(car.rejoin.ahead, "behind", byNum)}</div>
          <div className="tt-row dim2">{neighbour(car.rejoin.behind, "ahead of", byNum)}</div>
        </>
      )}
    </div>
  );
}

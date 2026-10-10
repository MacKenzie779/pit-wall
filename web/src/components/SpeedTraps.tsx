import type { Driver, SpeedTrap, TimingStats } from "../../../shared/types.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

const TRAPS: { key: SpeedTrap; label: string }[] = [
  { key: "I1", label: "INT 1" },
  { key: "I2", label: "INT 2" },
  { key: "FL", label: "FINISH" },
  { key: "ST", label: "TRAP" },
];

export function SpeedTraps() {
  const stats = useStore((s) => s.feed.TimingStats) as TimingStats | undefined;
  const drivers = useStore((s) => s.feed.DriverList) as Record<string, Driver> | undefined;

  const top = (trap: SpeedTrap) =>
    Object.entries(stats?.Lines ?? {})
      .map(([num, l]) => ({ num, v: Number(l?.BestSpeeds?.[trap]?.Value) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 5);

  return (
    <Panel title="SPEED TRAPS" className="speeds" right={<span className="dim">KM/H · SESSION BEST</span>}>
      <div className="trap-grid">
        {TRAPS.map((t) => (
          <div key={t.key} className="trap">
            <div className="trap-head">{t.label}</div>
            {top(t.key).map((x, i) => (
              <div key={x.num} className="trap-row">
                <i className="team" style={{ background: `#${drivers?.[x.num]?.TeamColour ?? "666"}` }} />
                <span className="trap-tla">{drivers?.[x.num]?.Tla ?? x.num}</span>
                <span className={i === 0 ? "c-purple" : ""}>{x.v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}

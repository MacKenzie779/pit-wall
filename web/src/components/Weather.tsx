import type { Weather as W } from "../../../shared/types.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

export function Weather() {
  const w = useStore((s) => s.feed.WeatherData) as W | undefined;
  const rain = w?.Rainfall && w.Rainfall !== "0";
  const dir = Number(w?.WindDirection ?? 0);
  return (
    <Panel title="WEATHER" className="weather" right={rain ? <span className="c-blue blink-slow">■ RAIN</span> : <span className="dim">DRY</span>}>
      <div className="wx-grid">
        <Stat label="TRACK" value={w?.TrackTemp} unit="°C" cls="c-amber" />
        <Stat label="AIR" value={w?.AirTemp} unit="°C" />
        <Stat label="HUMIDITY" value={w?.Humidity} unit="%" />
        <Stat label="PRESSURE" value={w?.Pressure} unit="mb" />
        <div className="wx">
          <div className="wx-label">WIND</div>
          <div className="wx-value">
            <span className="wx-arrow" style={{ transform: `rotate(${dir + 180}deg)` }} title={`from ${dir}°`}>
              ↑
            </span>
            {w?.WindSpeed ?? "—"}
            <span className="wx-unit">m/s</span>
          </div>
        </div>
        <Stat label="DIR" value={w?.WindDirection} unit="°" />
      </div>
    </Panel>
  );
}

function Stat({ label, value, unit, cls = "" }: { label: string; value?: string; unit: string; cls?: string }) {
  return (
    <div className="wx">
      <div className="wx-label">{label}</div>
      <div className={`wx-value ${cls}`}>
        {value ?? "—"}
        <span className="wx-unit">{unit}</span>
      </div>
    </div>
  );
}

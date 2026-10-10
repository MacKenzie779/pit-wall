import { useEffect, useMemo, useState } from "react";
import { ControlBar, SPEEDS } from "./components/ControlBar.tsx";
import { Header } from "./components/Header.tsx";
import { ChartsView } from "./components/ChartsView.tsx";
import { TrackView } from "./components/TrackView.tsx";
import { StandingsView } from "./components/StandingsView.tsx";
import { RaceControl } from "./components/RaceControl.tsx";
import { SpeedTraps } from "./components/SpeedTraps.tsx";
import { TimingTower } from "./components/TimingTower.tsx";
import { TyreStints } from "./components/TyreStints.tsx";
import { Weather } from "./components/Weather.tsx";
import { deriveRows } from "./derive.ts";
import { send, useStore } from "./store.ts";

export type View = "timing" | "track" | "charts" | "standings";
const VIEWS: View[] = ["timing", "track", "charts", "standings"];

export function App() {
  const feed = useStore((s) => s.feed);
  // Only the timing topics feed the tower; positions/car data update several times a second.
  const { kind, rows, cutoff } = useMemo(
    () => deriveRows(feed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.TimingData, feed.TimingAppData, feed.TimingStats, feed.DriverList, feed.SessionInfo, feed.StartingGrid],
  );
  const [view, setViewState] = useState<View>(() => {
    try {
      const v = localStorage.getItem("view") as View;
      return VIEWS.includes(v) ? v : "timing";
    } catch {
      return "timing";
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem("view", v);
    } catch {}
  };
  const [scanlines, setScanlines] = useState(() => {
    try {
      return localStorage.getItem("scanlines") !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const replay = useStore.getState().replay;
      if (e.key === " " && replay) {
        e.preventDefault();
        send({ cmd: replay.playing ? "pause" : "play" });
      } else if (/^[1-5]$/.test(e.key) && replay) {
        send({ cmd: "speed", value: SPEEDS[Number(e.key) - 1]! });
      } else if (e.key === "t" || e.key === "T") {
        setView("timing");
      } else if (e.key === "m" || e.key === "M") {
        setView("track");
      } else if (e.key === "c" || e.key === "C") {
        setView("charts");
      } else if (e.key === "w" || e.key === "W") {
        setView("standings");
      } else if (e.key === "s" || e.key === "S") {
        setScanlines((v) => {
          try {
            localStorage.setItem("scanlines", v ? "0" : "1");
          } catch {}
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app ${scanlines ? "scanlines" : ""}`}>
      <Header view={view} onView={setView} />
      {view === "timing" && (
        <main className="main">
          <TimingTower kind={kind} rows={rows} cutoff={cutoff} />
          <div className="side">
            <RaceControl />
            <TyreStints rows={rows} />
            <div className="side-row">
              <SpeedTraps />
              <Weather />
            </div>
          </div>
        </main>
      )}
      {view === "track" && <TrackView rows={rows} />}
      {view === "charts" && <ChartsView rows={rows} />}
      {view === "standings" && (
        <main className="main main-standings">
          <StandingsView rows={rows} />
        </main>
      )}
      <ControlBar />
    </div>
  );
}

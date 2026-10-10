import { toList } from "../../../shared/merge.ts";
import { useEffect, useState } from "react";
import type { Driver, RaceControlMessage } from "../../../shared/types.ts";
import { localTime } from "../format.ts";
import { useStore } from "../store.ts";
import { Panel } from "./Panel.tsx";

function tag(m: RaceControlMessage): { text: string; cls: string } {
  const f = (m.Flag ?? "").toUpperCase();
  if (m.Category === "SafetyCar") return { text: "SC", cls: "rc-sc" };
  if (m.Category === "Drs") return { text: "DRS", cls: "rc-info" };
  if (m.Category === "CarEvent") return { text: "CAR", cls: "rc-info" };
  if (f === "GREEN" || f === "CLEAR") return { text: f === "CLEAR" ? "CLR" : "GRN", cls: "rc-green" };
  if (f.includes("YELLOW")) return { text: f.startsWith("DOUBLE") ? "YY" : "YEL", cls: "rc-yellow" };
  if (f === "RED") return { text: "RED", cls: "rc-red" };
  if (f === "BLUE") return { text: "BLU", cls: "rc-blue" };
  if (f === "CHEQUERED") return { text: "CHQ", cls: "rc-chq" };
  if (f === "BLACK AND WHITE" || f === "BLACK AND ORANGE" || f === "BLACK") return { text: "B/W", cls: "rc-bw" };
  if (/STEWARDS|INVESTIGAT|PENALTY/i.test(m.Message)) return { text: "FIA", cls: "rc-fia" };
  return { text: "MSG", cls: "rc-msg" };
}

export function RaceControl() {
  const rcm = useStore((s) => s.feed.RaceControlMessages);
  const captures = useStore((s) => s.feed.TeamRadio?.Captures);
  const [tab, setTab] = useState<"rc" | "radio">("rc");
  const [seen, setSeen] = useState(0);
  const msgs = toList<RaceControlMessage>(rcm?.Messages).filter(Boolean).slice(-80).reverse();
  const clips = toList<RadioCapture>(captures).filter(Boolean);
  const unseen = tab === "radio" ? 0 : Math.max(0, clips.length - seen);
  useEffect(() => {
    if (tab === "radio") setSeen(clips.length);
  }, [tab, clips.length]);

  return (
    <Panel
      title={tab === "rc" ? "RACE CONTROL" : "TEAM RADIO"}
      className="rc"
      right={
        <span className="rc-tabs">
          <button className={tab === "rc" ? "on" : ""} onClick={() => setTab("rc")}>
            RC {msgs.length ? toList(rcm?.Messages).length : ""}
          </button>
          <button className={tab === "radio" ? "on" : ""} onClick={() => setTab("radio")}>
            RADIO {clips.length || ""}
            {unseen > 0 && <span className="badge">+{unseen}</span>}
          </button>
        </span>
      }
    >
      {tab === "rc" ? (
        <ol className="rc-list">
          {msgs.map((m, i) => {
            const t = tag(m);
            return (
              <li key={`${m.Utc}-${i}`} className={i === 0 ? "rc-new" : ""}>
                <span className="rc-time dim">{localTime(m.Utc)}</span>
                <span className="rc-lap dim">{m.Lap ? `L${m.Lap}` : ""}</span>
                <span className={`rc-tag ${t.cls}`}>{t.text}</span>
                <span className="rc-msg-text">{m.Message}</span>
              </li>
            );
          })}
          {!msgs.length && <li className="empty">NO MESSAGES</li>}
        </ol>
      ) : (
        <TeamRadio clips={clips} />
      )}
    </Panel>
  );
}

interface RadioCapture {
  Utc: string;
  RacingNumber: string;
  Path: string;
}

// One shared player: starting a clip stops the previous one.
const audio = typeof Audio !== "undefined" ? new Audio() : null;

function TeamRadio({ clips }: { clips: RadioCapture[] }) {
  const sessionPath = useStore((s) => s.feed.SessionInfo?.Path) as string | undefined;
  const drivers = useStore((s) => s.feed.DriverList) as Record<string, Driver> | undefined;
  const [playing, setPlaying] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!audio) return;
    const onTime = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const onEnd = () => {
      setPlaying("");
      setProgress(0);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onEnd);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onEnd);
    };
  }, []);

  const toggle = (c: RadioCapture) => {
    if (!audio || !sessionPath) return;
    if (playing === c.Path) {
      audio.pause();
      setPlaying("");
      setProgress(0);
      return;
    }
    audio.src = `https://livetiming.formula1.com/static/${sessionPath}${c.Path}`;
    void audio.play();
    setPlaying(c.Path);
    setProgress(0);
  };

  if (!clips.length) return <div className="empty">NO RADIO YET</div>;
  return (
    <ol className="rc-list radio-list">
      {clips
        .slice()
        .reverse()
        .map((c, i) => {
          const d = drivers?.[c.RacingNumber];
          const on = playing === c.Path;
          return (
            <li key={c.Path} className={i === 0 ? "rc-new" : ""}>
              <span className="rc-time dim">{localTime(c.Utc)}</span>
              <button className={`play ${on ? "on" : ""}`} onClick={() => toggle(c)} aria-label={on ? "Stop" : "Play"}>
                {on ? "■" : "▶"}
              </button>
              <span className="radio-who">
                <i className="team" style={{ background: `#${d?.TeamColour ?? "666"}` }} />
                <span className="tla">{d?.Tla ?? c.RacingNumber}</span>
                <span className="dim">{d?.FullName ?? ""}</span>
              </span>
              <span className="radio-progress">{on && <i style={{ width: `${progress * 100}%` }} />}</span>
            </li>
          );
        })}
    </ol>
  );
}

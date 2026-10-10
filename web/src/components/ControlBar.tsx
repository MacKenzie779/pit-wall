import { useEffect, useState } from "react";
import type { SessionListing } from "../../../shared/types.ts";
import { fmtDuration } from "../format.ts";
import { send, useStore } from "../store.ts";

export const SPEEDS = [1, 2, 5, 10, 20];
const THIS_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2022 }, (_, i) => THIS_YEAR - i);

export function ControlBar() {
  const source = useStore((s) => s.source);
  const replay = useStore((s) => s.replay);
  const [open, setOpen] = useState(false);

  return (
    <footer className="ctrl">
      <div className="ctrl-src">
        <button className={source === "live" ? "on" : ""} onClick={() => send({ cmd: "live" })}>
          ● LIVE
        </button>
        <button className={source === "replay" || open ? "on" : ""} onClick={() => setOpen((o) => !o)}>
          ▶ REPLAY {open ? "▴" : "▾"}
        </button>
      </div>

      {replay && (
        <div className="ctrl-replay">
          <span className="ctrl-title">{replay.title}</span>
          {replay.loading ? (
            <span className="c-amber blink-slow">LOADING ARCHIVE…</span>
          ) : (
            <>
              <button onClick={() => send({ cmd: replay.playing ? "pause" : "play" })} title="space">
                {replay.playing ? "❚❚ PAUSE" : "▶ PLAY"}
              </button>
              <button onClick={() => send({ cmd: "seek", ms: replay.start })} title="jump to session start">
                ⇤ START
              </button>
              <span className="ctrl-speeds">
                {SPEEDS.map((v, i) => (
                  <button key={v} className={replay.speed === v ? "on" : ""} onClick={() => send({ cmd: "speed", value: v })} title={`key ${i + 1}`}>
                    {v}×
                  </button>
                ))}
              </span>
              <input
                className="scrub"
                type="range"
                min={0}
                max={replay.duration}
                step={1000}
                value={replay.cursor}
                onChange={(e) => send({ cmd: "seek", ms: Number(e.target.value) })}
              />
              <span className="ctrl-time">
                {fmtDuration(replay.cursor)}
                <span className="dim"> / {fmtDuration(replay.duration)}</span>
              </span>
            </>
          )}
        </div>
      )}

      <div className="ctrl-keys dim">
        T/M/C/W tabs · SPACE play · 1-5 speed · S scanlines
        <span className="disclaimer">Unofficial · not associated with the Formula 1 companies</span>
      </div>
      {open && <SessionPicker onPick={() => setOpen(false)} />}
    </footer>
  );
}

function SessionPicker({ onPick }: { onPick: () => void }) {
  const [year, setYear] = useState(THIS_YEAR);
  const [list, setList] = useState<SessionListing[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setList(null);
    setErr("");
    fetch(`/api/sessions?year=${year}`)
      .then((r) => r.json())
      .then((d) => (Array.isArray(d) ? setList(d.slice().reverse()) : setErr(d.error ?? "failed")))
      .catch((e) => setErr(String(e)));
  }, [year]);

  return (
    <div className="picker">
      <div className="picker-years">
        {YEARS.map((y) => (
          <button key={y} className={y === year ? "on" : ""} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
      </div>
      <div className="picker-list">
        {err && <div className="c-red">ERROR: {err}</div>}
        {!list && !err && <div className="dim blink-slow">FETCHING INDEX…</div>}
        {list?.map((m, i) => (
          <div key={`${i}-${m.meeting}`} className="picker-meeting">
            <span className="picker-name">{m.meeting.toUpperCase()}</span>
            <span className="picker-sessions">
              {m.sessions.map((s) => (
                <button
                  key={s.path}
                  onClick={() => {
                    send({ cmd: "replay", path: s.path, title: `${year} ${m.meeting} · ${s.name}` });
                    onPick();
                  }}
                >
                  {s.name}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

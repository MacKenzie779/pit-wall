# Pit Wall

A live-timing dashboard for Formula 1 sessions with a pit-wall terminal look. It runs on
your own machine, reads the public live-timing feed used by formula1.com, and can replay
any archived session.

> **Unofficial.** This project is not associated in any way with the Formula 1 companies.
> F1, FORMULA ONE, FORMULA 1 and related marks are trademarks of Formula One Licensing B.V.
> All timing data, audio and other content belong to their respective owners; this
> repository contains none of it. Run it for personal, non-commercial use and check
> Formula 1's terms of use before doing anything else with the data.

## Run it

Requires [Bun](https://bun.sh) (tested with 1.4.2).

```sh
bun install
bun run dev                  # API server :4000 + Vite :5173, open http://localhost:5173
bun run build && bun start   # single server on http://127.0.0.1:4000
bun test
```

The server only listens on `127.0.0.1`.

## Features

- **Timing tower**: positions, gaps, intervals, lap and sector times with
  personal/overall-best colours, mini-sectors, tyres and pit status. The columns change
  for race, qualifying and practice.
- **Qualifying projection (PROJ)**: on a push lap, the sectors done so far plus the
  driver's personal-best sectors for the rest, with the position it would give (red =
  elimination zone). Out laps and cool-down laps are skipped. A "≈" marks laps where a
  personal best was clearly an out-lap time, so the session-best sector at this lap's pace
  was used instead. Tested on two qualifying sessions: typical error 0.3 s after S1 and
  0.15–0.2 s after S2.
- **Track map**: in replays, real car positions with a two-driver telemetry view (speed,
  throttle, brake, gear and time delta over a lap). Live, positions are estimated from
  mini-sector completions, because the live feed only includes GPS for F1 TV subscribers.
  The estimate is calibrated once per circuit from an archived session (median error
  21 m, 90th percentile 80 m against real GPS).
- **Flags on the map**: yellow and double-yellow marshal sectors, red-flag track, and
  corner numbers.
- **Charts** (races and sprints): position by lap and gap to leader, with driver focus.
- **Pit window ("circle of doom")**: the field placed round one lap by time behind the
  leader, so lapped cars sit next to the cars they're racing on the road. Focused cars get
  a ghost where they would rejoin after a stop, with the position and the gaps to the cars
  around them. The pit loss is set per circuit (default 22 s, `−`/`+` in the panel header)
  and is the green-flag figure, so under a safety car a real stop costs less.
- **Standings**: drivers' and constructors' championships. During a race or sprint they
  show the projected table as if the session ended now.
- **Race control and team radio** panels, plus weather and speed traps.
- **Replay** any archived session from 2023 onwards at 1–20× speed with a scrubber.

Keys: `T` timing · `M` track · `C` charts · `W` standings · `space` play/pause ·
`1`–`5` speed · `S` scanlines.

## How it works

- `server/`: a small SignalR Core client for the live feed, the archive replay, and a hub
  that merges feed deltas and fans them out to the browser over `/ws`. The hub also
  derives a few extra feeds: gap history, the starting grid and estimated live positions.
- `shared/`: the delta-merge logic used on both sides, and types.
- `web/`: the React UI.

Downloaded archives, calibrations and circuit data are cached in `.cache/`. A full race
is about 35 MB.

### Third-party data

Marshal-sector and corner positions aren't in the timing feed. They come from
MultiViewer's public circuit API (`api.multiviewer.app`). That API is unofficial and
undocumented, and only the circuit key and year are sent. Team radio clips play directly
from formula1.com's live-timing archive.

## License

[MIT](LICENSE) for the code in this repository. The license covers this code only, not
the Formula 1 data, audio or trademarks it works with.

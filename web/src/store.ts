import { create } from "zustand";
import { applyDelta, type FeedState } from "../../shared/merge.ts";
import type { ClientMsg, LiveStatus, ReplayStatus, ServerMsg, SourceMode } from "../../shared/types.ts";

interface Store {
  feed: FeedState;
  source: SourceMode;
  live: LiveStatus;
  replay: ReplayStatus | null;
  now: number; // server clock (virtual during replay), UTC ms
  socket: boolean;
  /** Bumped on every full snapshot so components can skip change-flashes for it. */
  epoch: number;
}

export const useStore = create<Store>(() => ({
  feed: {},
  source: "live",
  live: { connected: false },
  replay: null,
  now: Date.now(),
  socket: false,
  epoch: 0,
}));

let ws: WebSocket | null = null;

export function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(batch: ServerMsg[]) {
  const s = useStore.getState();
  let { feed, source, live, replay, now, epoch } = s;
  for (const m of batch) {
    switch (m.type) {
      case "snapshot":
        feed = m.state;
        source = m.source;
        epoch++;
        break;
      case "delta":
        feed = applyDelta(feed, m.topic, m.delta);
        break;
      case "clock":
        now = m.now;
        break;
      case "live":
        live = m.status;
        break;
      case "replay":
        replay = m.status;
        break;
    }
  }
  useStore.setState({ feed, source, live, replay, now, epoch });
}

export function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => useStore.setState({ socket: true });
  ws.onmessage = (ev) => {
    try {
      handle(JSON.parse(ev.data));
    } catch (err) {
      console.error(err);
    }
  };
  ws.onclose = () => {
    useStore.setState({ socket: false });
    setTimeout(connect, 1500);
  };
}

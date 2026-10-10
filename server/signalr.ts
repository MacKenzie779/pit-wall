// Minimal ASP.NET Core SignalR (JSON protocol) client for F1 live timing.
// Only what we need: negotiate, handshake, Subscribe invocation, feed messages, pings.

import { TOPICS } from "../shared/topics.ts";

const BASE = "https://livetiming.formula1.com/signalrcore";
const RS = "\x1e";
const UA = "Mozilla/5.0 (X11; Linux x86_64) f1-dash";
const PING_MS = 15_000;
const IDLE_TIMEOUT_MS = 60_000;

export interface LiveHandlers {
  snapshot(state: Record<string, unknown>): void;
  delta(topic: string, delta: unknown): void;
  status(connected: boolean, error?: string): void;
}

export class LiveClient {
  private ws: WebSocket | null = null;
  private running = false;
  private backoff = 1000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMsg = 0;

  constructor(private h: LiveHandlers) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.backoff = 1000;
    void this.connect();
  }

  stop() {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.cleanup();
    this.h.status(false);
  }

  /** Drop the connection and reconnect, getting a fresh full snapshot. */
  restart() {
    this.cleanup();
    if (this.running) this.scheduleReconnect(0);
  }

  private cleanup() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
      try {
        ws.close();
      } catch {}
    }
  }

  private scheduleReconnect(delay = this.backoff) {
    if (!this.running) return;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    this.cleanup();
    try {
      const res = await fetch(`${BASE}/negotiate?negotiateVersion=1`, {
        method: "POST",
        headers: { "User-Agent": UA },
      });
      if (!res.ok) throw new Error(`negotiate HTTP ${res.status}`);
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const { connectionToken } = (await res.json()) as { connectionToken: string };
      if (!this.running) return;

      const url = `${BASE.replace(/^http/, "ws")}?id=${encodeURIComponent(connectionToken)}`;
      // Bun's WebSocket accepts custom headers; the sticky-session cookie is required.
      const ws = new WebSocket(url, { headers: { Cookie: cookie, "User-Agent": UA } } as any);
      this.ws = ws;
      let handshakeDone = false;

      ws.onopen = () => {
        ws.send(JSON.stringify({ protocol: "json", version: 1 }) + RS);
      };
      ws.onmessage = (ev) => {
        this.lastMsg = Date.now();
        const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        for (const frame of text.split(RS)) {
          if (!frame) continue;
          let msg: any;
          try {
            msg = JSON.parse(frame);
          } catch {
            continue;
          }
          if (!handshakeDone) {
            handshakeDone = true;
            if (msg.error) throw new Error(`handshake: ${msg.error}`);
            this.onHandshake(ws);
            continue;
          }
          this.onMessage(ws, msg);
        }
      };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.h.status(false, `closed (${ev.code})`);
        this.cleanup();
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        if (this.ws !== ws) return;
        this.h.status(false, "socket error");
      };
    } catch (err) {
      this.h.status(false, String((err as Error).message ?? err));
      this.scheduleReconnect();
    }
  }

  private onHandshake(ws: WebSocket) {
    ws.send(
      JSON.stringify({ type: 1, invocationId: "1", target: "Subscribe", arguments: [TOPICS] }) + RS,
    );
    this.lastMsg = Date.now();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMsg > IDLE_TIMEOUT_MS) {
        this.h.status(false, "idle timeout");
        this.restart();
        return;
      }
      ws.send(JSON.stringify({ type: 6 }) + RS);
    }, PING_MS);
  }

  private onMessage(ws: WebSocket, msg: any) {
    switch (msg.type) {
      case 1: // invocation
        if (msg.target === "feed" && Array.isArray(msg.arguments)) {
          const [topic, delta] = msg.arguments;
          this.h.delta(topic, delta);
        }
        break;
      case 3: // completion of Subscribe
        if (msg.invocationId === "1") {
          if (msg.error) {
            this.h.status(false, `subscribe: ${msg.error}`);
            ws.close();
            return;
          }
          this.backoff = 1000;
          this.h.status(true);
          this.h.snapshot(msg.result ?? {});
        }
        break;
      case 6: // ping
        break;
      case 7: // close
        this.h.status(false, msg.error ? `server closed: ${msg.error}` : "server closed");
        this.restart();
        break;
    }
  }
}

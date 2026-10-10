import { join, normalize } from "node:path";
import type { ClientMsg } from "../shared/types.ts";
import { Hub } from "./hub.ts";
import { listSessions } from "./replay.ts";
import { getStandings } from "./standings.ts";

const PORT = Number(process.env.PORT ?? 4000);
const DIST = join(import.meta.dir, "../web/dist");
const PROD = process.env.NODE_ENV === "production";

const hub = new Hub();

// Circuit details F1's feed doesn't carry (marshal sectors, corner numbers) come from
// MultiViewer's public circuit API, in the same coordinate system as F1's position data.
const CIRCUIT_DIR = join(import.meta.dir, "../.cache/circuits");

async function circuitInfo(key: number, year: number) {
  if (!Number.isInteger(key) || !Number.isInteger(year)) return null;
  for (const y of [year, year - 1, year - 2]) {
    const file = Bun.file(join(CIRCUIT_DIR, `${key}-${y}.json`));
    if (await file.exists()) return file.json();
    const res = await fetch(`https://api.multiviewer.app/api/v1/circuits/${key}/${y}`, {
      headers: { "User-Agent": "f1-dash" },
    }).catch(() => null);
    if (!res?.ok) continue;
    const d: any = await res.json();
    const point = (m: any) => ({ number: m.number, x: m.trackPosition?.x, y: m.trackPosition?.y, angle: m.angle });
    const info = {
      marshalSectors: (d.marshalSectors ?? []).map(point),
      corners: (d.corners ?? []).map(point),
    };
    await Bun.write(file, JSON.stringify(info));
    return info;
  }
  return null;
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    }

    if (url.pathname === "/api/sessions") {
      const year = Number(url.searchParams.get("year") ?? new Date().getUTCFullYear());
      try {
        return Response.json(await listSessions(year));
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 502 });
      }
    }

    if (url.pathname === "/api/track") return Response.json(hub.outline);

    if (url.pathname === "/api/circuit") {
      const info = await circuitInfo(Number(url.searchParams.get("key")), Number(url.searchParams.get("year")));
      return Response.json(info);
    }

    if (url.pathname.startsWith("/api/replay/")) {
      const tel = hub.replayPlayer?.telemetry;
      const cursor = hub.replayPlayer?.cursorMs ?? 0;
      if (!tel) return Response.json({ error: "no replay telemetry" }, { status: 404 });
      const num = url.searchParams.get("num") ?? "";
      switch (url.pathname) {
        case "/api/replay/laps":
          return Response.json(tel.lapsUntil(num, cursor));
        case "/api/replay/trace":
          return Response.json(tel.trace(num, Number(url.searchParams.get("lap")), cursor));
      }
    }

    if (url.pathname === "/api/standings") {
      try {
        return Response.json(await getStandings(url.searchParams.get("exclude") ?? ""));
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 502 });
      }
    }

    if (PROD) {
      const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = Bun.file(join(DIST, rel));
      if (!rel.includes("..") && (await file.exists())) return new Response(file);
      return new Response(Bun.file(join(DIST, "index.html")));
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open: (ws) => hub.open(ws),
    close: (ws) => hub.close(ws),
    message(_ws, raw) {
      try {
        hub.command(JSON.parse(String(raw)) as ClientMsg);
      } catch {}
    },
  },
});

console.log(`f1-dash server on http://127.0.0.1:${PORT}${PROD ? "" : " (api/ws only; UI via vite on :5173)"}`);

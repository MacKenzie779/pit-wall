import { useEffect, useRef, useState } from "react";
import type React from "react";
import { useStore } from "./store.ts";

/** Returns a class that re-triggers a short highlight whenever `value` changes (not on snapshots). */
export function useFlash(value: unknown): string {
  const epoch = useStore((s) => s.epoch);
  const prev = useRef(value);
  const prevEpoch = useRef(epoch);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== value && prevEpoch.current === epoch && value) setN((x) => x + 1);
    prev.current = value;
    prevEpoch.current = epoch;
  }, [value, epoch]);
  return n === 0 ? "" : n % 2 ? "flash-a" : "flash-b";
}

/** Element size via ResizeObserver. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** GET JSON, refetched whenever `key` changes; null while loading or on error. */
export function useJson<T>(url: string | null, key: unknown = url): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key]);
  return data;
}

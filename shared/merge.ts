// Delta merge semantics for F1 live timing feeds.
//
// Deltas are partial objects that get deep-merged into the current state:
// - plain objects merge recursively
// - an array in the delta replaces the target
// - an object with numeric keys merged into an existing array updates/appends by index
//   (e.g. `Stints: {"1": {...}}`, `Messages: {"14": {...}}`)
// - `_deleted: ["Key"]` removes those keys from the merged object
// Changed paths get new references; untouched branches keep theirs.

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function merge(target: unknown, delta: unknown): unknown {
  if (Array.isArray(delta)) return delta;
  if (!isObj(delta)) return delta;

  if (Array.isArray(target)) {
    const out = target.slice();
    for (const [k, v] of Object.entries(delta)) {
      if (k === "_deleted") continue;
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0) continue;
      out[i] = merge(out[i], v);
    }
    return out;
  }

  const out: Obj = isObj(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(delta)) {
    if (k === "_deleted") continue;
    out[k] = merge(out[k], v);
  }
  const deleted = delta._deleted;
  if (Array.isArray(deleted)) for (const k of deleted) delete out[String(k)];
  return out;
}

export type FeedState = Record<string, any>;

export function applyDelta(state: FeedState, topic: string, delta: unknown): FeedState {
  return { ...state, [topic]: merge(state[topic], delta) };
}

/** Normalise an array-or-index-keyed-object into an array (gaps stay undefined). */
export function toList<T>(v: T[] | Record<string, T> | undefined | null): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  const out: T[] = [];
  for (const [k, x] of Object.entries(v)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0) out[i] = x;
  }
  return out;
}

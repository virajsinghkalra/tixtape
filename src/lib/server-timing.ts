/**
 * Per-request `Server-Timing` (D-086). `route()` runs each handler inside `timed()`; anything in
 * that async context (today: every Postgres query and connection open, via `src/db/client.ts`)
 * reports its span here, and `route()` writes one header:
 *
 *   Server-Timing: db;dur=4.2;desc="3x", db-connect;dur=38.0;desc="1x", total;dur=9.8
 *
 * `db` is wall time with at least one query in flight, so parallel queries are not double
 * counted. Nothing here knows about Postgres; it only aggregates named spans.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Span = { busyMs: number; count: number; inflight: number; since: number };
type Timings = { started: number; spans: Map<string, Span> };

const store = new AsyncLocalStorage<Timings>();
const now = () => performance.now();

/** Runs `fn` with a fresh timing context; outside one, `spanStart` is a no-op. */
export function timed<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ started: now(), spans: new Map() }, fn);
}

/**
 * Marks the start of one `name` span in the current request and returns its `end`. Call `end`
 * exactly once. Safe to call from any async context: it binds to the request it started in.
 */
export function spanStart(name: string): () => void {
  const t = store.getStore();
  if (!t) return () => {};
  let s = t.spans.get(name);
  if (!s) t.spans.set(name, (s = { busyMs: 0, count: 0, inflight: 0, since: 0 }));
  const span = s;
  if (span.inflight++ === 0) span.since = now();
  span.count++;
  return () => {
    if (--span.inflight === 0) span.busyMs += now() - span.since;
  };
}

/** The header value for the current request, or null outside `timed()`. */
export function serverTimingHeader(): string | null {
  const t = store.getStore();
  if (!t) return null;
  const parts: string[] = [];
  for (const [name, s] of t.spans) {
    // A span still open (e.g. a pool connection opening that no query waited for) counts so far.
    const busy = s.busyMs + (s.inflight > 0 ? now() - s.since : 0);
    parts.push(`${name};dur=${busy.toFixed(1)};desc="${s.count}x"`);
  }
  parts.push(`total;dur=${(now() - t.started).toFixed(1)}`);
  return parts.join(", ");
}

/** Adds `Server-Timing` to a response. Immutable headers (e.g. `Response.redirect`) are left as is. */
export function withServerTiming(res: Response): Response {
  const value = serverTimingHeader();
  if (value === null) return res;
  try {
    res.headers.set("Server-Timing", value);
  } catch {
    // Immutable headers: timing is diagnostics only, never worth failing a response.
  }
  return res;
}

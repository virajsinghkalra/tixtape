/**
 * The type-ahead engine (D-042, D-048), free of React so it can be unit-tested with fake timers.
 * - No request under 2 characters; queries are trimmed, whitespace-collapsed and capped at 100.
 * - 120ms debounce (D-057); each new query aborts the request in flight.
 * - Race-safe: a response for anything but the latest query is ignored.
 * - While a new query loads, the previous response stays (marked `stale`, the UI dims it).
 * - Small LRU cache: repeating a query answers instantly without a request.
 * - One quiet retry on a network error or any 5xx (`retrying`); 4xx is not retried.
 * - `slow` turns on 300ms into a request, so the spinner only shows when it's worth it.
 */
import { LruCache } from "./lru";
import { EMPTY_RESPONSE, SearchHttpError, type SearchSource, type SuggestResponse } from "./types";

export const MIN_CHARS = 2;
export const MAX_CHARS = 100;

export type SearchError = "offline" | "server";

export type SearchState = {
  /** The normalized query (and city filter) this state belongs to. */
  query: string;
  city: string | undefined;
  status: "idle" | "loading" | "done" | "error";
  response: SuggestResponse;
  /** True while `response` belongs to an earlier query. */
  stale: boolean;
  slow: boolean;
  retrying: boolean;
  error: SearchError | null;
};

export const IDLE: SearchState = {
  query: "",
  city: undefined,
  status: "idle",
  response: EMPTY_RESPONSE,
  stale: false,
  slow: false,
  retrying: false,
  error: null,
};

export type EventSearchOptions = {
  source: SearchSource;
  debounceMs?: number;
  slowMs?: number;
  retryDelayMs?: number;
  cacheSize?: number;
  isOnline?: () => boolean;
};

export type EventSearch = {
  getState(): SearchState;
  subscribe(listener: () => void): () => void;
  setQuery(raw: string, city?: string): void;
  /** Runs the current query again now (the Retry button). */
  retry(): void;
  dispose(): void;
};

export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS).trim();
}

const defaultOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export function createEventSearch(options: EventSearchOptions): EventSearch {
  const { source, debounceMs = 120, slowMs = 300, retryDelayMs = 300, cacheSize = 30 } = options;
  const isOnline = options.isOnline ?? defaultOnline;
  const cache = new LruCache<string, SuggestResponse>(cacheSize);
  const listeners = new Set<() => void>();
  let state = IDLE;
  let latest = 0;
  let controller: AbortController | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const keyOf = (query: string, city?: string) => `${query.toLowerCase()}|${city ?? ""}`;

  function set(next: SearchState) {
    state = next;
    listeners.forEach((l) => l());
  }

  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  }

  function cancelPending() {
    timers.forEach(clearTimeout);
    timers.clear();
    controller?.abort();
    controller = null;
  }

  function start(query: string, city: string | undefined, delayMs: number) {
    const id = ++latest;
    cancelPending();
    if (query.length < MIN_CHARS) return set({ ...IDLE, query, city });

    const cached = cache.get(keyOf(query, city));
    if (cached) return set({ ...IDLE, query, city, status: "done", response: cached });

    const hasPrevious = state.status === "done" || state.stale;
    set({
      ...IDLE,
      query,
      city,
      status: "loading",
      response: hasPrevious ? state.response : EMPTY_RESPONSE,
      stale: hasPrevious,
    });
    later(() => void run(query, city, id), delayMs);
  }

  async function run(query: string, city: string | undefined, id: number) {
    if (!isOnline()) return set({ ...IDLE, query, city, status: "error", error: "offline" });
    controller = new AbortController();
    const { signal } = controller;
    later(
      () => id === latest && state.status === "loading" && set({ ...state, slow: true }),
      slowMs,
    );
    const attempt = () => source({ query, city }, signal);
    try {
      let response: SuggestResponse;
      try {
        response = await attempt();
      } catch (err) {
        if (signal.aborted || !isTransient(err)) throw err;
        if (id === latest) set({ ...state, retrying: true });
        await sleep(retryDelayMs, signal);
        response = await attempt();
      }
      if (id !== latest) return;
      cache.set(keyOf(query, city), response);
      set({ ...IDLE, query, city, status: "done", response });
    } catch (err) {
      if (id !== latest || signal.aborted) return;
      set({ ...IDLE, query, city, status: "error", error: isOnline() ? "server" : "offline" });
      if (!(err instanceof SearchHttpError) && !(err instanceof TypeError)) console.error(err);
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuery(raw, city) {
      const query = normalizeQuery(raw);
      if (query === state.query && city === state.city && state.status !== "error") return;
      start(query, city, debounceMs);
    },
    retry() {
      start(state.query, state.city, 0);
    },
    dispose() {
      latest++;
      cancelPending();
      listeners.clear();
    },
  };
}

/** Network failures (fetch rejects with TypeError) and any 5xx are worth one quiet retry. */
export function isTransient(err: unknown): boolean {
  if (err instanceof SearchHttpError) return err.status >= 500;
  return err instanceof TypeError;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventSearch, normalizeQuery, type EventSearch } from "./event-search";
import {
  EMPTY_RESPONSE,
  SearchHttpError,
  type SearchSource,
  type Suggestion,
  type SuggestResponse,
} from "./types";

const hit = (title: string): Suggestion => ({
  id: title,
  title,
  type: "festival",
  startsAt: "2027-01-23T06:30:00.000Z",
  startsAtDateOnly: false,
  city: "Mumbai",
  venueName: null,
  matchReason: "title",
  matchedText: title.slice(0, 3),
});

const reply = (results: Suggestion[]): SuggestResponse => ({ ...EMPTY_RESPONSE, results });

/** A source whose calls the test resolves or rejects by hand. */
function manualSource() {
  const calls: {
    query: string;
    city?: string;
    signal: AbortSignal;
    resolve: (r: SuggestResponse) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const source: SearchSource = ({ query, city }, signal) =>
    new Promise((resolve, reject) => calls.push({ query, city, signal, resolve, reject }));
  return { source, calls };
}

let search: EventSearch;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  search?.dispose();
  vi.useRealTimers();
});

describe("normalizeQuery", () => {
  it("trims, collapses whitespace and caps at 100 characters", () => {
    expect(normalizeQuery("  lolla   2027 ")).toBe("lolla 2027");
    expect(normalizeQuery("x".repeat(200))).toHaveLength(100);
  });
});

describe("createEventSearch", () => {
  it("sends nothing under two characters or for blank input", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("l");
    search.setQuery("     ");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(0);
    expect(search.getState().status).toBe("idle");
  });

  it("debounces: only the last keystroke within 120ms is sent", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("lo");
    await vi.advanceTimersByTimeAsync(100);
    search.setQuery("lol");
    await vi.advanceTimersByTimeAsync(119);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => c.query)).toEqual(["lol"]);
    calls[0]!.resolve(reply([hit("Lollapalooza")]));
    await vi.advanceTimersByTimeAsync(0);
    expect(search.getState()).toMatchObject({ status: "done", query: "lol" });
  });

  it("aborts the request in flight when the query changes and ignores its late response", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("lol");
    await vi.advanceTimersByTimeAsync(120);
    search.setQuery("diljit");
    expect(calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    calls[1]!.resolve(reply([hit("Diljit Live")]));
    await vi.advanceTimersByTimeAsync(0);
    calls[0]!.resolve(reply([hit("Lollapalooza")])); // late, stale
    await vi.advanceTimersByTimeAsync(0);
    expect(search.getState().response.results.map((r) => r.title)).toEqual(["Diljit Live"]);
  });

  it("answers a repeated query from the cache without a request", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("lol");
    await vi.advanceTimersByTimeAsync(120);
    calls[0]!.resolve(reply([hit("Lollapalooza")]));
    await vi.advanceTimersByTimeAsync(0);
    search.setQuery("");
    search.setQuery("LOL");
    expect(search.getState()).toMatchObject({ status: "done", query: "LOL" });
    expect(calls).toHaveLength(1);
  });

  it("retries once on a 5xx, then succeeds", async () => {
    let n = 0;
    const source: SearchSource = async () => {
      n++;
      if (n === 1) throw new SearchHttpError(503);
      return reply([hit("NH7 Weekender")]);
    };
    search = createEventSearch({ source });
    search.setQuery("nh7");
    await vi.advanceTimersByTimeAsync(120 + 300);
    expect(n).toBe(2);
    expect(search.getState().status).toBe("done");
  });

  it("does not retry a 4xx and reports a server error", async () => {
    const source = vi.fn<SearchSource>().mockRejectedValue(new SearchHttpError(400));
    search = createEventSearch({ source });
    search.setQuery("nh7");
    await vi.advanceTimersByTimeAsync(1000);
    expect(source).toHaveBeenCalledTimes(1);
    expect(search.getState()).toMatchObject({ status: "error", error: "server" });
  });

  it("gives up after one retry on repeated network errors", async () => {
    const source = vi.fn<SearchSource>().mockRejectedValue(new TypeError("Failed to fetch"));
    search = createEventSearch({ source });
    search.setQuery("nh7");
    await vi.advanceTimersByTimeAsync(1000);
    expect(source).toHaveBeenCalledTimes(2);
    expect(search.getState().status).toBe("error");
  });

  it("reports offline without sending a request", async () => {
    const source = vi.fn<SearchSource>();
    search = createEventSearch({ source, isOnline: () => false });
    search.setQuery("nh7");
    await vi.advanceTimersByTimeAsync(300);
    expect(source).not.toHaveBeenCalled();
    expect(search.getState()).toMatchObject({ status: "error", error: "offline" });
  });

  it("marks a request slow after 300ms so the UI can show it is searching", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("lol");
    await vi.advanceTimersByTimeAsync(120 + 299);
    expect(search.getState().slow).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(search.getState()).toMatchObject({ status: "loading", slow: true });
    calls[0]!.resolve(reply([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(search.getState()).toMatchObject({ status: "done", slow: false });
  });

  it("notifies subscribers on every change", async () => {
    const { source } = manualSource();
    search = createEventSearch({ source });
    const listener = vi.fn();
    search.subscribe(listener);
    search.setQuery("lol");
    expect(listener).toHaveBeenCalled();
  });

  it("keeps the previous results visible, marked stale, while the next query loads", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("lol");
    await vi.advanceTimersByTimeAsync(120);
    calls[0]!.resolve(reply([hit("Lollapalooza")]));
    await vi.advanceTimersByTimeAsync(0);
    search.setQuery("lolla");
    expect(search.getState()).toMatchObject({ status: "loading", stale: true });
    expect(search.getState().response.results).toHaveLength(1);
  });

  it("flags the quiet retry, and retry() re-runs the query at once", async () => {
    const source = vi.fn<SearchSource>().mockRejectedValue(new SearchHttpError(500));
    search = createEventSearch({ source });
    search.setQuery("nh7");
    await vi.advanceTimersByTimeAsync(120);
    expect(search.getState().retrying).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(search.getState().status).toBe("error");
    source.mockResolvedValue(reply([hit("NH7 Weekender")]));
    search.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(search.getState().status).toBe("done");
  });

  it("sends the city filter and caches per city", async () => {
    const { source, calls } = manualSource();
    search = createEventSearch({ source });
    search.setQuery("gigs", "Pune");
    await vi.advanceTimersByTimeAsync(120);
    expect(calls[0]).toMatchObject({ query: "gigs", city: "Pune" });
  });
});

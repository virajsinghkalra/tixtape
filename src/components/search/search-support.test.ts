import { describe, expect, it, vi } from "vitest";
import { LruCache } from "./lru";
import { pushRecent, readRecent, writeRecent } from "./recent-searches";
import { suggestSource } from "./source";
import { SearchHttpError, type Suggestion } from "./types";

const s = (title: string, matchReason: Suggestion["matchReason"] = "title"): Suggestion => ({
  id: title,
  title,
  type: "concert",
  startsAt: "2027-02-06T13:30:00.000Z",
  startsAtDateOnly: false,
  city: null,
  venueName: null,
  matchReason,
  matchedText: title,
});

const jsonFetch = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe("recent searches", () => {
  it("keeps newest first, de-duplicates case-insensitively and caps the list", () => {
    expect(pushRecent(["Lolla", "nh7"], "lolla")).toEqual(["lolla", "nh7"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
    expect(pushRecent(["a"], "   ")).toEqual(["a"]);
  });

  it("survives broken or throwing storage", () => {
    expect(readRecent({ getItem: () => "{not json" })).toEqual([]);
    expect(readRecent({ getItem: () => JSON.stringify(["ok", 3]) })).toEqual(["ok"]);
    expect(
      readRecent({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual([]);
    expect(() =>
      writeRecent(["x"], {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });
});

describe("suggestSource", () => {
  it("calls suggest with q and city, and fills D-047 fields the server doesn't send yet", async () => {
    const fetchFn = jsonFetch({ results: [{ ...s("Lollapalooza India"), matchReason: "alias" }] });
    const res = await suggestSource(fetchFn)(
      { query: "lolla", city: "Mumbai" },
      new AbortController().signal,
    );
    expect(fetchFn.mock.calls[0]![0]).toBe("/api/events/suggest?q=lolla&city=Mumbai");
    expect(res.results[0]).toMatchObject({ title: "Lollapalooza India", matchReason: "alias" });
    expect(res).toMatchObject({ artists: [], cities: [], filters: {}, fallback: [] });
  });

  it("parses the full D-047 typed response", async () => {
    const fetchFn = jsonFetch({
      results: [],
      artists: [{ name: "Prateek Kuhad", upcomingCount: 1, matchedText: "Prat" }],
      cities: [{ city: "Pune", upcomingCount: 5 }],
      filters: { city: "Pune" },
      fallback: [s("NH7 Weekender")],
      didYouMean: "diljit",
    });
    const res = await suggestSource(fetchFn)({ query: "prat" }, new AbortController().signal);
    expect(res.artists[0]?.name).toBe("Prateek Kuhad");
    expect(res.cities[0]?.city).toBe("Pune");
    expect(res.didYouMean).toBe("diljit");
    expect(res.fallback).toHaveLength(1);
  });

  it("throws SearchHttpError on a non-2xx", async () => {
    const source = suggestSource(jsonFetch({ error: {} }, 503));
    await expect(source({ query: "x" }, new AbortController().signal)).rejects.toBeInstanceOf(
      SearchHttpError,
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { ArtistCandidate, EventResult, SuggestionCandidate } from "@/domain/events/search";
import {
  searchPage,
  SearchPageParamsSchema,
  suggest,
  SuggestParamsSchema,
  type SearchDeps,
} from "./search-events";
import { FakeEventSearch, FakeSearchLog } from "./testing/fakes";

const now = new Date("2026-11-25T06:00:00Z");

const ev = (id: string, over: Partial<EventResult> = {}): EventResult => ({
  id,
  title: `Event ${id}`,
  type: "concert",
  startsAt: new Date("2026-12-12T14:00:00Z"),
  startsAtDateOnly: false,
  city: "Pune",
  venueName: "Lawns",
  ...over,
});
const cand = (id: string, over: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
  ...ev(id),
  venueNormalizedName: "lawns",
  titleSimilarity: 0,
  venueSimilarity: 0,
  trendScore: 0,
  trendUpdatedAt: now,
  artist: null,
  ...over,
});
const kuhad: ArtistCandidate = {
  id: "a1",
  name: "Prateek Kuhad",
  normalizedName: "prateek kuhad",
  spotifyId: null,
  imageUrl: null,
  similarity: 0.9,
  isFilter: false,
  upcomingCount: 2,
};

function setup() {
  const search = new FakeEventSearch();
  const searchLog = new FakeSearchLog();
  const logger = { warn: vi.fn() };
  const deps: SearchDeps = { search, searchLog, clock: { now: () => now }, logger };
  return { search, searchLog, logger, deps };
}

describe("SuggestParamsSchema", () => {
  it.each([
    [{}, {}],
    [{ q: "" }, { q: "" }],
    [{ q: "   " }, { q: "" }],
    [{ q: "  lolla   2027 " }, { q: "lolla 2027" }],
    [
      { q: "lo", city: " Pune " },
      { q: "lo", city: "Pune" },
    ],
  ])("accepts %j", (raw, expected) => {
    expect(SuggestParamsSchema.parse(raw)).toMatchObject(expected);
  });

  it.each([
    [{ q: "l" }],
    [{ q: "%" }],
    [{ q: "x".repeat(101) }],
    [{ q: "lolla", limit: "5" }],
    [{ city: "" }],
  ])("rejects %j", (raw) => {
    expect(SuggestParamsSchema.safeParse(raw).success).toBe(false);
  });
});

describe("SearchPageParamsSchema", () => {
  it.each([
    [{ q: "lolla" }, { q: "lolla", page: 1, pageSize: 20 }],
    [
      { artist: "Prateek Kuhad", page: "2", pageSize: "50" },
      { artist: "Prateek Kuhad", page: 2, pageSize: 50 },
    ],
    [{ city: "Pune", from: "2026-12-01", to: "2026-12-31" }, { city: "Pune" }],
  ])("accepts %j", (raw, expected) => {
    expect(SearchPageParamsSchema.parse(raw)).toMatchObject(expected);
  });

  it.each([
    [{}],
    [{ q: "" }],
    [{ q: "lolla", pageSize: "51" }],
    [{ q: "lolla", page: "0" }],
    [{ type: "party" }],
    [{ q: "x", extra: "1" }],
  ])("rejects %j", (raw) => {
    expect(SearchPageParamsSchema.safeParse(raw).success).toBe(false);
  });
});

describe("suggest (typed)", () => {
  it("returns ranked results with artists, cities and the understood filters", async () => {
    const { deps, search, searchLog } = setup();
    search.candidates = {
      events: [
        cand("e1", {
          title: "Silhouettes Tour",
          artist: {
            name: "Prateek Kuhad",
            normalizedName: "prateek kuhad",
            similarity: 0.9,
            isFilter: false,
          },
        }),
      ],
      artists: [kuhad],
      cities: [{ city: "Pune", upcomingCount: 3 }],
    };
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "prateek in pune" }));
    expect(res).toEqual({
      results: [
        expect.objectContaining({
          id: "e1",
          matchReason: "artist",
          matchedArtist: "Prateek Kuhad",
        }),
      ],
      artists: [{ id: "a1", name: "Prateek Kuhad", upcomingCount: 2, matchedText: "Prateek" }],
      cities: [{ city: "Pune", upcomingCount: 3 }],
      filters: { city: "Pune" },
    });
    expect(search.calls[0]!.plan).toMatchObject({ text: "prateek", filters: { city: "Pune" } });
    expect(searchLog.searches).toEqual([]); // suggest never logs (D-048)
  });

  it("never dead-ends: empty results come with a fallback and a hint (issue 8)", async () => {
    const { deps, search } = setup();
    search.candidates = {
      events: [cand("near", { title: "Coldfest", titleSimilarity: 0.35 })],
      artists: [],
      cities: [],
    };
    search.fallbackEvents = [ev("f1"), ev("f2", { city: "Goa" })];
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "coldplay" }));
    expect(res).toMatchObject({ results: [], didYouMean: "Coldfest" });
    expect("fallback" in res && res.fallback?.map((e) => [e.id, e.matchReason])).toEqual([
      ["f1", "title"],
      ["f2", "title"],
    ]);
  });

  it("falls back within the filtered city first, then anywhere", async () => {
    const { deps, search } = setup();
    search.fallbackEvents = [ev("goa", { city: "Goa" })];
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "edm in pune" }));
    expect(search.fallbackCalls).toEqual([
      { city: "Pune", from: null, to: null },
      { city: null, from: null, to: null },
    ]);
    expect("fallback" in res && res.fallback?.map((e) => e.id)).toEqual(["goa"]);
  });

  it("skips the database when only punctuation is left", async () => {
    const { deps, search } = setup();
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "%%" }));
    expect(search.calls).toHaveLength(0);
    expect(res).toMatchObject({ results: [], artists: [], cities: [], filters: {} });
  });

  it("returns at most 8 results", async () => {
    const { deps, search } = setup();
    search.candidates.events = Array.from({ length: 12 }, (_, i) =>
      cand(`e${i}`, { title: `Arena ${i}` }),
    );
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "arena" }));
    expect("results" in res && res.results).toHaveLength(8);
  });
});

describe("suggest (empty query, issue 9)", () => {
  it("builds sections without repeats, adding Near you for a city", async () => {
    const { deps, search } = setup();
    search.recommendations = {
      trending: [ev("t1"), ev("t2")],
      upNext: [],
      thisWeekend: [ev("t1"), ev("w1")],
      nearYou: [ev("w1"), ev("p1")],
      popularSearches: ["lolla", "nh7"],
    };
    const res = await suggest(deps, SuggestParamsSchema.parse({ q: "", city: "poona" }));
    expect(
      "sections" in res &&
        res.sections.map((s) => [s.id, "items" in s ? s.items.map((i) => i.id) : s.queries]),
    ).toEqual([
      ["trending", ["t1", "t2"]],
      ["this_weekend", ["w1"]],
      ["near_you", ["p1"]],
      ["popular_searches", ["lolla", "nh7"]],
    ]);
    expect(search.recommendationCalls[0]).toMatchObject({
      city: "Pune",
      weekend: { from: new Date("2026-11-26T18:30:00Z"), to: new Date("2026-11-29T18:29:59.999Z") },
      popularSince: new Date("2026-11-18T06:00:00Z"),
    });
  });

  it("has no Near you section without a city", async () => {
    const { deps, search } = setup();
    search.recommendations = {
      trending: [ev("t1")],
      upNext: [],
      thisWeekend: [],
      nearYou: [],
      popularSearches: [],
    };
    const res = await suggest(deps, SuggestParamsSchema.parse({}));
    expect("sections" in res && res.sections.map((s) => s.id)).toEqual(["trending"]);
    expect(search.recommendationCalls[0]!.city).toBeNull();
  });
});

describe("searchPage (D-048)", () => {
  it("paginates the same ranked results and reports the total", async () => {
    const { deps, search } = setup();
    search.candidates.events = Array.from({ length: 7 }, (_, i) =>
      cand(`e${i}`, { title: `Arena ${i}`, startsAt: new Date(Date.UTC(2026, 11, i + 1)) }),
    );
    const res = await searchPage(
      deps,
      SearchPageParamsSchema.parse({ q: "arena", page: "2", pageSize: "3" }),
    );
    expect(res).toMatchObject({ total: 7, page: 2, pageSize: 3 });
    expect(res.results.map((r) => r.id)).toEqual(["e3", "e4", "e5"]);
    expect(search.calls[0]!.limit).toBe(500);
  });

  it("applies explicit artist and city filters", async () => {
    const { deps, search } = setup();
    await searchPage(
      deps,
      SearchPageParamsSchema.parse({
        artist: "Prateek Kuhad",
        city: "bangalore",
        to: "2026-12-31",
      }),
    );
    expect(search.calls[0]!.plan).toMatchObject({
      hasText: false,
      filters: {
        artistKey: "prateek kuhad",
        city: "Bengaluru",
        to: new Date("2026-12-31T23:59:59.999Z"),
      },
    });
  });

  it("logs a committed query on page 1 only, and survives a logging failure", async () => {
    const { deps, searchLog, logger } = setup();
    await searchPage(deps, SearchPageParamsSchema.parse({ q: "Lolla  Mumbai" }));
    await searchPage(deps, SearchPageParamsSchema.parse({ q: "lolla", page: "2" }));
    await searchPage(deps, SearchPageParamsSchema.parse({ city: "Pune" }));
    expect(searchLog.searches).toEqual([{ query: "lolla mumbai", resultsCount: 0, at: now }]);

    vi.spyOn(searchLog, "recordSearch").mockRejectedValueOnce(new Error("db down"));
    await expect(
      searchPage(deps, SearchPageParamsSchema.parse({ q: "nh7" })),
    ).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

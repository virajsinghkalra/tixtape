import { describe, expect, it, vi } from "vitest";
import {
  AiUnavailableError,
  type GroundedExtractor,
  type WebPage,
  type WebSearch,
} from "@/application/ports/web-search";
import type { ValidatedCandidate } from "@/domain/events/extract/candidate";
import { verifyEvent } from "@/domain/events/extract/verify";
import { DoubtResolver, doubtReasons, type DoubtStore } from "./doubt-resolver";

const now = new Date("2026-11-21T10:00:00Z");
const target = {
  key: "sunburn\u0000event:23439",
  title: "Sunburn Festival 2026",
  city: "Mumbai",
  startsAt: new Date("2026-12-18T00:00:00+05:30"),
};

const djmag: WebPage = {
  url: "https://djmag.com/news/sunburn-festival-2026-full-line-up-announced",
  title: "Sunburn Festival 2026 full line-up announced",
  content:
    "Sunburn Festival 2026 full line-up announced. The festival takes place at Mahalaxmi Racecourse in Mumbai on December 18 and 19, 2026. Headlining are DJ Snake, The Chainsmokers and Sebastian Ingrosso.",
};
const bookmyshow: WebPage = {
  url: "https://in.bookmyshow.com/events/sunburn-festival-2026/ET00498558",
  title: "Sunburn Festival 2026",
  content: "Buy tickets. DJ Snake, Anyma.",
};
const reply = {
  title: "Sunburn Festival 2026",
  startDate: "2026-12-18",
  endDate: "2026-12-19",
  city: "Mumbai",
  venue: "Mahalaxmi Racecourse",
  headliners: ["DJ Snake", "The Chainsmokers", "Sebastian Ingrosso"],
  support: [],
  quotes: {
    title: "Sunburn Festival 2026 full line-up announced",
    startDate: "on December 18 and 19, 2026",
    city: "Mahalaxmi Racecourse in Mumbai",
    venue: "at Mahalaxmi Racecourse",
    headliners: "Headlining are DJ Snake, The Chainsmokers and Sebastian Ingrosso",
  },
};

function memoryStore(): DoubtStore & {
  used: Map<string, { searches: number; modelCalls: number }>;
} {
  const used = new Map<string, { searches: number; modelCalls: number }>();
  const cache = new Map<string, { value: unknown; at: Date }>();
  return {
    used,
    usage: async (day) => used.get(day) ?? { searches: 0, modelCalls: 0 },
    addUsage: async (day, d) => {
      const u = used.get(day) ?? { searches: 0, modelCalls: 0 };
      used.set(day, {
        searches: u.searches + (d.searches ?? 0),
        modelCalls: u.modelCalls + (d.modelCalls ?? 0),
      });
    },
    cached: async (k) => cache.get(k),
    cache: async (k, value, at) => void cache.set(k, { value, at }),
  };
}

function setup(
  over: {
    pages?: WebPage[];
    extract?: GroundedExtractor["extract"];
    fetchPage?: (url: string) => Promise<string>;
    caps?: { searchesPerDay: number; modelCallsPerDay: number };
  } = {},
) {
  let t = now.getTime();
  const search: WebSearch & { calls: Array<{ query: string; exclude: readonly string[] }> } = {
    calls: [],
    async search(query, opts) {
      this.calls.push({ query, exclude: opts.excludeDomains });
      return over.pages ?? [bookmyshow, djmag];
    },
  };
  const extract = vi.fn(over.extract ?? (async () => reply));
  const store = memoryStore();
  // Our own fetch of the page; by default the same text the search saw.
  const fetchPage = vi.fn(
    over.fetchPage ??
      (async (url: string) =>
        (over.pages ?? [bookmyshow, djmag]).find((p) => p.url === url)!.content),
  );
  const resolver = new DoubtResolver({
    search,
    extractor: { extract },
    fetchPage,
    store,
    clock: { now: () => new Date(t) },
    logger: { info: vi.fn(), warn: vi.fn() },
    caps: over.caps,
  });
  return { resolver, search, extract, fetchPage, store, advance: (ms: number) => (t += ms) };
}

describe("DoubtResolver (D-064)", () => {
  it("searches once, skips denied domains, and turns a grounded page into a candidate", async () => {
    const { resolver, search, extract } = setup();
    const found = await resolver.resolve(target, ["lineup single"]);
    expect(search.calls).toHaveLength(1);
    expect(search.calls[0]!.query).toBe("Sunburn Festival 2026 Mumbai 2026 lineup");
    expect(search.calls[0]!.exclude).toContain("bookmyshow.com");
    expect(extract).toHaveBeenCalledTimes(1); // BookMyShow never reaches the model
    expect(found).toEqual([
      expect.objectContaining({
        source: "web",
        trust: "trusted",
        url: djmag.url,
        title: "Sunburn Festival 2026",
        city: "Mumbai",
        venueName: "Mahalaxmi Racecourse",
        dateExplicit: true,
        startsAt: new Date("2026-12-18T00:00:00+05:30"),
        artists: [
          { name: "DJ Snake", parts: [] },
          { name: "The Chainsmokers", parts: [] },
          { name: "Sebastian Ingrosso", parts: [] },
        ],
      }),
    ]);
    expect(resolver.usage).toMatchObject({
      searches: 1,
      modelCalls: 1,
      cacheHits: 0,
      stopped: null,
    });
  });

  it("grounds against our own fetch of the page, not the search service's copy (D-070)", async () => {
    const { resolver, extract, fetchPage } = setup({
      // The live page no longer names the lineup the search snippet showed.
      fetchPage: async () =>
        "Sunburn Festival 2026 full line-up announced. It takes place at Mahalaxmi Racecourse in Mumbai on December 18 and 19, 2026.",
    });
    const found = await resolver.resolve(target, ["lineup single"]);
    expect(fetchPage).toHaveBeenCalledWith(djmag.url);
    expect(extract.mock.calls[0]![0].page.content).not.toContain("Headlining");
    expect(found[0]!.artists).toEqual([]);
    expect(resolver.usage.notes[0]!.pages[0]!.dropped).toEqual(
      expect.arrayContaining([expect.stringMatching(/^headliners:/u)]),
    );
  });

  it("skips a page it can't fetch itself", async () => {
    const { resolver, extract } = setup({
      fetchPage: async () => {
        throw new Error("djmag.com resolves to a private or reserved address; not fetched.");
      },
    });
    expect(await resolver.resolve(target, ["x"])).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
    expect(resolver.usage.notes[0]!.pages[0]!.dropped[0]).toMatch(/could not be fetched/u);
  });

  it("drops a page whose facts can't be grounded (the model is never a source)", async () => {
    const { resolver } = setup({
      extract: async () => ({ ...reply, quotes: { ...reply.quotes, startDate: "in December" } }),
    });
    expect(await resolver.resolve(target, ["lineup missing"])).toEqual([]);
    expect(resolver.usage.notes[0]!.pages[0]!.dropped).toEqual(
      expect.arrayContaining(["page: no grounded title, explicit date and city"]),
    );
  });

  it("reuses the extraction for 24 h while the page text is unchanged", async () => {
    const { resolver, extract, advance } = setup();
    await resolver.resolve(target, ["x"]);
    advance(23 * 3_600_000);
    await resolver.resolve(target, ["x"]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(resolver.usage.cacheHits).toBe(1);
    advance(2 * 3_600_000);
    await resolver.resolve(target, ["x"]);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("respects the daily search and model-call caps", async () => {
    const searchCap = setup({ caps: { searchesPerDay: 1, modelCallsPerDay: 10 } });
    await searchCap.resolver.resolve(target, ["x"]);
    expect(await searchCap.resolver.resolve({ ...target, key: "other" }, ["x"])).toEqual([]);
    expect(searchCap.resolver.usage.stopped).toMatch(/daily search cap/u);

    const modelCap = setup({ caps: { searchesPerDay: 10, modelCallsPerDay: 0 } });
    expect(await modelCap.resolver.resolve(target, ["x"])).toEqual([]);
    expect(modelCap.extract).not.toHaveBeenCalled();
    expect(modelCap.resolver.usage.stopped).toMatch(/daily model-call cap/u);
  });

  it("skips gracefully for the rest of the run on a 429 or quota error", async () => {
    const { resolver, search } = setup({
      extract: async () => {
        throw new AiUnavailableError("github-models", "GitHub Models rate limit reached.");
      },
    });
    expect(await resolver.resolve(target, ["x"])).toEqual([]);
    expect(await resolver.resolve({ ...target, key: "other" }, ["x"])).toEqual([]);
    expect(search.calls).toHaveLength(1);
    expect(resolver.usage.stopped).toBe("GitHub Models rate limit reached.");
    // The failed call still counts against the daily allowance.
    expect(resolver.usage.modelCalls).toBe(1);
  });
});

describe("doubtReasons (D-062)", () => {
  const base: ValidatedCandidate = {
    source: "sunburn",
    trust: "official",
    externalId: "event:23439",
    url: "https://sunburn.in/event/sunburn-festival-2026/",
    title: "Sunburn Festival 2026",
    type: "festival",
    startsAt: target.startsAt,
    endsAt: new Date("2026-12-19T00:00:00+05:30"),
    dateExplicit: true,
    city: "Mumbai",
    country: "IN",
    venueName: "Mahalaxmi Racecourse",
    artists: ["DJ Snake", "Anyma"],
    supportActs: [],
    confidence: 0.9,
  };

  it("a corroborated event with active headliners, above 0.9, isn't in doubt", () => {
    const identities = new Map([
      ["dj snake", { wikidataId: "Q1", mbid: "m1", lastReleaseYear: 2026 }],
      ["anyma", { wikidataId: "Q2", mbid: "m2", lastReleaseYear: 2025 }],
    ]);
    const v = verifyEvent(
      [
        base,
        {
          ...base,
          source: "rollingstone",
          trust: "trusted",
          externalId: "rs",
          url: "https://rollingstoneindia.com/x/",
          fingerprint: "text:rs",
        },
      ],
      { now, identities, venueGeoCity: "Mumbai" },
    );
    expect(v.confidence).toBeGreaterThanOrEqual(0.9);
    expect(doubtReasons(v)).toEqual([]);
    // The same listing alone, without identity checks, is just under the threshold: a doubt.
    expect(doubtReasons(verifyEvent([base], { now }))).toEqual([
      expect.stringMatching(/^confidence 0\.\d+ just under 0\.9$/u),
    ]);
  });

  it("missing lineup and venue are doubts", () => {
    expect(doubtReasons(verifyEvent([{ ...base, artists: [], venueName: null }], { now }))).toEqual(
      ["lineup missing", "venue missing"],
    );
  });

  it("a date conflict is a doubt", () => {
    const other = {
      ...base,
      source: "rollingstone" as const,
      trust: "trusted" as const,
      externalId: "x",
      url: "https://rollingstoneindia.com/x/",
      startsAt: new Date("2026-12-20T00:00:00+05:30"),
      endsAt: null,
    };
    expect(doubtReasons(verifyEvent([base, other], { now }))).toContain("date conflict");
  });
});

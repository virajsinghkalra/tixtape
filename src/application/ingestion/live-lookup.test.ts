import { describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/application/events";
import { ingestEvents } from "@/application/events/ingest-events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";
import { FakeArtistCatalog, spotifyArtist } from "@/application/matching/testing/fakes";
import type { RateLimiter } from "@/application/ports/engagement";
import type { SourceAdapter } from "@/application/ports/event-source";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import type { EventCandidate } from "@/domain/events/extract/candidate";
import type { RawEvent } from "@/domain/events/raw-event";
import { RateLimitedError, UpstreamError } from "@/lib/errors";
import {
  LiveLookup,
  LOOKUP_CAP_MS,
  lookupIdFor,
  LookupRequestSchema,
  recogniseArtist,
  type LiveLookupDeps,
  type LookupCache,
  type LookupResponse,
} from "./live-lookup";
import { createMemoryCandidateStore, createMemoryValidationCache } from "./ports";
import { ArtistValidator } from "./validate-artists";

const start = new Date("2026-11-21T10:00:00Z");

const coldplayMumbai: EventCandidate = {
  source: "wikipedia",
  trust: "trusted",
  externalId: "123:2027-01-18:mumbai",
  url: "https://en.wikipedia.org/wiki/Music_of_the_Spheres_World_Tour",
  title: "Coldplay – Music of the Spheres World Tour",
  type: "concert",
  startsAt: new Date("2027-01-18T00:00:00+05:30"),
  endsAt: null,
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: "DY Patil Stadium",
  artists: [{ name: "Coldplay", parts: [] }],
  confidence: 0.7,
};

const tmEvent: RawEvent = {
  source: "ticketmaster",
  externalId: "tm-1",
  url: "https://www.ticketmaster.com/event/tm-1",
  title: "Coldplay Live",
  type: "concert",
  startsAt: new Date("2027-01-19T14:30:00Z"),
  venue: { name: "DY Patil Stadium", city: "Navi Mumbai", country: "IN" },
  lineup: [{ name: "Coldplay", tier: "headliner", billingRank: 1 }],
  raw: {},
};

class Limiter implements RateLimiter {
  constructor(private left: number) {}
  async take() {
    return this.left-- > 0;
  }
}

/** The Postgres cache's behaviour in memory: entries expire at `expiresAt`. */
function memoryCache(): LookupCache & {
  rows: Map<string, { response: LookupResponse; expiresAt: Date }>;
} {
  const rows = new Map<string, { response: LookupResponse; expiresAt: Date }>();
  return {
    rows,
    async get(id, now) {
      const r = rows.get(id);
      return r && r.expiresAt.getTime() > now.getTime() ? r.response : null;
    },
    async set(e) {
      rows.set(e.lookupId, { response: e.response, expiresAt: e.expiresAt });
    },
  };
}

/** A sleep that resolves only when the test fires it: the 6 s cap is explicit. */
function manualSleep() {
  const pending: Array<{ ms: number; resolve: () => void }> = [];
  return {
    sleep: (ms: number) => new Promise<void>((resolve) => pending.push({ ms, resolve })),
    fire: () => pending.splice(0).forEach((p) => p.resolve()),
    pending,
  };
}

const suggestion = (title: string) => ({ id: "e1", title }) as unknown as Suggestion;

function setup(over: Partial<LiveLookupDeps> = {}) {
  let t = start.getTime();
  const clock = { now: () => new Date(t) };
  const world = fakeEventsWorld(start);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const catalog = new FakeArtistCatalog({
    coldplay: [spotifyArtist("4gzpq5DPGxSnKTe4SA8HAU", "Coldplay", 0)],
    Coldplay: [spotifyArtist("4gzpq5DPGxSnKTe4SA8HAU", "Coldplay", 0)],
  });
  const time = manualSleep();
  const store = createMemoryCandidateStore();
  const cache = memoryCache();
  const search = vi.fn(async (q: string) =>
    world.events.events.some((e) => /coldplay/iu.test(e.title) && /coldplay/iu.test(q))
      ? [suggestion("Coldplay Live")]
      : [],
  );
  const wikipedia = { lookUp: vi.fn(async (): Promise<EventCandidate[]> => [coldplayMumbai]) };
  const deps: LiveLookupDeps = {
    catalog,
    wikipedia,
    ticketmaster: null,
    validator: new ArtistValidator({
      catalog,
      artists: world.artists,
      cache: createMemoryValidationCache(),
      clock,
    }),
    store,
    cache,
    ingest: (adapter, opts) => ingestEvents({ ...world, clock, logger }, adapter, opts),
    search,
    resolvePendingArtists: vi.fn(async () => undefined),
    clientLimiter: new Limiter(10),
    globalLimiter: new Limiter(60),
    clock,
    logger,
    sleep: time.sleep,
    ...over,
  };
  return {
    lookup: new LiveLookup(deps),
    deps,
    world,
    wikipedia,
    search,
    time,
    store,
    cache,
    advance: (ms: number) => (t += ms),
  };
}

const tmAdapter = (): SourceAdapter => ({
  source: "ticketmaster",
  async *fetch() {
    yield tmEvent;
  },
});

describe("LookupRequestSchema", () => {
  it.each([
    [{ q: "Coldplay" }, true],
    [{ q: " x " }, false],
    [{ q: "a".repeat(101) }, false],
    [{ q: "Coldplay", extra: 1 }, false],
  ])("%j → %s", (body, ok) => {
    expect(LookupRequestSchema.safeParse(body).success).toBe(ok);
  });
});

describe("LiveLookup (D-070: synchronous, Postgres-cached)", () => {
  const id = lookupIdFor("coldplay");

  it("returns the final answer in the same request, with a stable lookupId", async () => {
    const { lookup, wikipedia } = setup();
    wikipedia.lookUp.mockResolvedValue([]);
    const r = await lookup.lookup("Coldplay", "ip-1");
    expect(r).toMatchObject({ status: "not_found", artist: { name: "Coldplay" }, lookupId: id });
    expect(lookupIdFor("  COLDPLAY ")).toBe(id);
  });

  it("answers a repeat from the cache without redoing the work, in < 50 ms", async () => {
    const { lookup, wikipedia } = setup();
    wikipedia.lookUp.mockResolvedValue([]);
    await lookup.lookup("coldplay", "ip-1");
    const t0 = performance.now();
    const again = await lookup.lookup("Coldplay", "ip-2");
    expect(performance.now() - t0).toBeLessThan(50);
    expect(again.status).toBe("not_found");
    expect(wikipedia.lookUp).toHaveBeenCalledTimes(1);
  });

  it("GET-style poll answers from the cache, or null when unknown or expired", async () => {
    const { lookup, wikipedia, advance } = setup();
    wikipedia.lookUp.mockResolvedValue([]);
    expect(await lookup.poll(id)).toBeNull();
    await lookup.lookup("coldplay", "ip-1");
    expect(await lookup.poll(id)).toMatchObject({ status: "not_found", lookupId: id });
    advance(31 * 60_000);
    expect(await lookup.poll(id)).toBeNull();
  });

  it("never runs past the 6 s cap; the answer keeps what Spotify recognised", async () => {
    const { lookup, wikipedia, time } = setup();
    wikipedia.lookUp.mockImplementation(() => new Promise(() => {}));
    const pending = lookup.lookup("coldplay", "ip-1");
    await vi.waitFor(() => expect(wikipedia.lookUp).toHaveBeenCalled());
    expect(time.pending.map((p) => p.ms)).toEqual([LOOKUP_CAP_MS]);
    time.fire();
    expect(await pending).toMatchObject({ status: "not_found", artist: { name: "Coldplay" } });
  });

  it("caches not_found for 30 min and ambiguous for 10 min", async () => {
    const olivia = new FakeArtistCatalog({
      olivia: [
        spotifyArtist("1McMsnEElThX1knmY4oliG", "Olivia Rodrigo", 0),
        spotifyArtist("00x1fYSGhdqScXBRpSj3DW", "Olivia Dean", 1),
      ],
    });
    const { lookup, wikipedia, advance } = setup({ catalog: olivia });
    wikipedia.lookUp.mockResolvedValue([]);
    expect(await lookup.lookup("olivia", "ip-1")).toMatchObject({
      status: "not_found",
      ambiguous: true,
    });
    expect(await lookup.lookup("zzqx fest", "ip-1")).toMatchObject({ status: "not_found" });
    advance(11 * 60_000);
    expect(await lookup.poll(lookupIdFor("olivia"))).toBeNull();
    expect(await lookup.poll(lookupIdFor("zzqx fest"))).not.toBeNull();
    advance(20 * 60_000);
    expect(await lookup.poll(lookupIdFor("zzqx fest"))).toBeNull();
  });

  it("found: a Ticketmaster find is ingested (held, D-056), answered from our search, cached 10 min", async () => {
    const { lookup, advance, world } = setup({ ticketmaster: () => tmAdapter() });
    expect(await lookup.lookup("Coldplay", "ip-1")).toMatchObject({
      status: "found",
      results: [suggestion("Coldplay Live")],
    });
    expect(world.events.events).toHaveLength(1);
    advance(9 * 60_000);
    expect(await lookup.poll(id)).toMatchObject({ status: "found" });
    advance(2 * 60_000);
    expect(await lookup.poll(id)).toBeNull();
  });

  it("Wikipedia finds become candidates for review, never events (D-055), idempotently", async () => {
    const { lookup, store, world, advance } = setup();
    await lookup.lookup("Coldplay", "ip-1");
    advance(31 * 60_000);
    await lookup.lookup("Coldplay", "ip-1");
    expect(world.events.events).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
  });

  it("D-073: an artist query runs artist-first discovery and answers 'checking', never the dates", async () => {
    const lookUp = vi.fn(async () => 3);
    const { lookup, wikipedia, world } = setup({ artistGigs: { lookUp } });
    wikipedia.lookUp.mockResolvedValue([]);
    const r = await lookup.lookup("coldplay", "ip-1");
    expect(lookUp).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Coldplay", spotifyId: "4gzpq5DPGxSnKTe4SA8HAU" }),
    );
    expect(r).toMatchObject({ status: "not_found", artist: { name: "Coldplay" }, checking: 3 });
    expect(JSON.stringify(r)).not.toMatch(/2026|2027/u);
    expect(world.events.events).toHaveLength(0);
  });

  it("D-073: discovery failing or finding nothing leaves the usual answer", async () => {
    const failing = setup({
      artistGigs: { lookUp: vi.fn(async () => Promise.reject(new Error("tavily down"))) },
    });
    failing.wikipedia.lookUp.mockResolvedValue([]);
    expect(await failing.lookup.lookup("coldplay", "ip-1")).not.toHaveProperty("checking");
    const unknown = setup({ artistGigs: { lookUp: vi.fn(async () => 2) } });
    unknown.wikipedia.lookUp.mockResolvedValue([]);
    await unknown.lookup.lookup("zzzz unknown", "ip-1");
    expect(unknown.deps.artistGigs!.lookUp).not.toHaveBeenCalled();
  });

  it("rate limits per client (429) and answers 'searching' (uncached) over the global cap", async () => {
    const perClient = setup({ clientLimiter: new Limiter(1) });
    perClient.wikipedia.lookUp.mockResolvedValue([]);
    await perClient.lookup.lookup("Coldplay", "ip-1");
    await expect(perClient.lookup.lookup("Prateek Kuhad", "ip-1")).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    const global = setup({ globalLimiter: new Limiter(0) });
    expect(await global.lookup.lookup("Coldplay", "ip-9")).toMatchObject({ status: "searching" });
    expect(global.wikipedia.lookUp).not.toHaveBeenCalled();
    expect(global.cache.rows.size).toBe(0);
  });

  it("Spotify blocked: recognition is skipped and the lookup still runs", async () => {
    const blocked = new SpotifyBlockedError("gate_paused", new Date("2026-11-21T11:00:00Z"));
    const catalog = new FakeArtistCatalog({}).failOn("Coldplay", blocked);
    const { lookup, wikipedia } = setup({ catalog });
    wikipedia.lookUp.mockResolvedValue([]);
    expect(await lookup.lookup("Coldplay", "ip-1")).toMatchObject({ status: "not_found" });
    expect(wikipedia.lookUp).toHaveBeenCalledWith("Coldplay", start);
  });

  it("Wikipedia malformed: logged, and the answer is not_found", async () => {
    const { lookup, wikipedia, deps } = setup();
    wikipedia.lookUp.mockRejectedValue(new UpstreamError("wikipedia", "unexpected shape"));
    expect(await lookup.lookup("zzqx fest", "ip-1")).toMatchObject({ status: "not_found" });
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it("a failing cache never breaks the lookup", async () => {
    const broken: LookupCache = {
      get: async () => {
        throw new Error("db down");
      },
      set: async () => {
        throw new Error("db down");
      },
    };
    const { lookup, wikipedia } = setup({ cache: broken });
    wikipedia.lookUp.mockResolvedValue([]);
    expect(await lookup.lookup("Coldplay", "ip-1")).toMatchObject({ status: "not_found" });
  });
});

const oliviaResults = [
  spotifyArtist("1McMsnEElThX1knmY4oliG", "Olivia Rodrigo", 0),
  spotifyArtist("00x1fYSGhdqScXBRpSj3DW", "Olivia Dean", 1),
  spotifyArtist("2a2b3c4d5e6f7g8h9i0j1k", "Olivia Ong", 2, { imageUrl: null }),
  spotifyArtist("3a2b3c4d5e6f7g8h9i0j1k", "Olivia", 3),
];

describe("recogniseArtist", () => {
  it("'olivia' is ambiguous: several artists start with it, so none is picked", () => {
    const r = recogniseArtist("olivia", oliviaResults);
    expect(r.artist).toBeNull();
    // Top three by rank, those with a photo first.
    expect(r.artists.map((a) => a.name)).toEqual(["Olivia Rodrigo", "Olivia Dean", "Olivia"]);
  });

  it("an exact-name artist that isn't the top result is not 'the' artist", () => {
    expect(recogniseArtist("Olivia", oliviaResults).artist).toBeNull();
  });

  it("'olivia rodrigo' is an exact top match", () => {
    const r = recogniseArtist("olivia rodrigo", [
      spotifyArtist("1McMsnEElThX1knmY4oliG", "Olivia Rodrigo", 0),
      spotifyArtist("4a2b3c4d5e6f7g8h9i0j1k", "Olivia Rodrigo Karaoke", 1),
    ]);
    expect(r.artist?.name).toBe("Olivia Rodrigo");
  });

  it("'diljit' is a strong single: only the top result starts with it", () => {
    const r = recogniseArtist("diljit", [
      spotifyArtist("2FKWNmZWDBZR4dE5KX4plR", "Diljit Dosanjh", 0),
      spotifyArtist("5a2b3c4d5e6f7g8h9i0j1k", "Sonam Bajwa", 1),
    ]);
    expect(r.artist?.name).toBe("Diljit Dosanjh");
  });

  it("an exact runner-up makes an exact top result ambiguous", () => {
    const r = recogniseArtist("Arijit", [
      spotifyArtist("7a2b3c4d5e6f7g8h9i0j1k", "Arijit", 0),
      spotifyArtist("8a2b3c4d5e6f7g8h9i0j1k", "ARIJIT", 1),
    ]);
    expect(r.artist).toBeNull();
  });

  it("a top result that doesn't match the query is not recognised", () => {
    expect(
      recogniseArtist("prateek", [spotifyArtist("9a2b3c4d5e6f7g8h9i0j1k", "Kuhad", 0)]).artist,
    ).toBeNull();
  });
});

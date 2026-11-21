import { describe, expect, it, vi } from "vitest";
import { ingestEvents } from "@/application/events/ingest-events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";
import { FakeArtistCatalog, spotifyArtist } from "@/application/matching/testing/fakes";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import type { CollectorSource, EventCandidate } from "@/domain/events/extract/candidate";
import type { Verification } from "@/domain/events/extract/verify";
import type { EventId } from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";
import { UpstreamError } from "@/lib/errors";
import { collectEvents, publishEvents, type CollectMode } from "./collect-events";
import { DoubtResolver } from "./doubt-resolver";
import {
  createMemoryCandidateStore,
  createMemoryValidationCache,
  type CandidateSource,
  type EventVerificationStore,
  type EventVisibility,
} from "./ports";
import { ArtistValidator } from "./validate-artists";

const now = new Date("2026-11-21T10:00:00Z");
const lineup = ["DJ Snake", "Sebastian Ingrosso", "The Chainsmokers", "Jason Derulo", "Anyma"];
const mention = (name: string) => ({ name, parts: [] });

/** Golden: Sunburn 2026 as the organiser posts it. */
const sunburn: EventCandidate = {
  source: "sunburn",
  trust: "official",
  externalId: "post:24000",
  url: "https://sunburn.in/sunburn-festival-2026-lineup/",
  title: "Sunburn Festival 2026",
  type: "festival",
  startsAt: new Date("2026-12-18T00:00:00+05:30"),
  endsAt: new Date("2026-12-19T00:00:00+05:30"),
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: "Mahalaxmi Racecourse",
  artists: lineup.map(mention),
  confidence: 0.9,
  fingerprint: "text:sunburn",
};
const rsi: EventCandidate = {
  ...sunburn,
  source: "rollingstone",
  trust: "trusted",
  externalId: "https://rollingstoneindia.com/?p=2",
  url: "https://rollingstoneindia.com/sunburn-2026-lineup/",
  fingerprint: "text:rsi",
};
const teamInnovation: EventCandidate = {
  source: "teaminnovation",
  trust: "official",
  externalId: "upcoming-show/charlie-puth-johnnie-music-festival",
  url: "https://teaminnovation.in/upcoming-show/charlie-puth-johnnie-music-festival.html",
  title: "Johnnie & Co. Music Festival",
  type: "festival",
  startsAt: new Date("2027-02-13T00:00:00+05:30"),
  endsAt: null,
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: null,
  artists: [mention("Charlie Puth")],
  confidence: 0.9,
  fingerprint: "https://teaminnovation.in/upcoming-show/charlie-puth-johnnie-music-festival.html",
};

function source(name: CollectorSource, items: EventCandidate[], fail?: Error): CandidateSource {
  return {
    source: name,
    async *collect() {
      yield* items;
      if (fail) throw fail;
    },
  };
}

/** D-056 columns over the fake events table. */
function fakeVerification(world: ReturnType<typeof fakeEventsWorld>) {
  const rows = new Map<
    string,
    { visibility: EventVisibility; verification: Verification | null; lastVerifiedAt: Date | null }
  >();
  const row = (id: string) => {
    if (!rows.has(id)) {
      rows.set(id, { visibility: "held", verification: null, lastVerifiedAt: null });
    }
    return rows.get(id)!;
  };
  const store: EventVerificationStore & { rows: typeof rows; past: string[][] } = {
    rows,
    past: [],
    async save(id, verification, checkedAt) {
      row(id).verification = verification;
      row(id).lastVerifiedAt = checkedAt;
    },
    async listMissingLineups(at) {
      return world.events.events
        .filter((e) => (e.endsAt ?? e.startsAt).getTime() >= at.getTime())
        .filter((e) => {
          const r = row(e.id);
          const status = r.verification?.fields.headliners.status ?? "missing";
          return r.visibility !== "archived" && (status === "missing" || status === "single");
        })
        .map((e) => e.title);
    },
    async get(id) {
      const e = world.events.events.find((x) => x.id === id);
      if (!e) return null;
      return { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, ...row(id) };
    },
    async setVisibility(id, visibility) {
      row(id).visibility = visibility;
    },
    async archivePast(at) {
      let n = 0;
      for (const e of world.events.events) {
        if ((e.endsAt ?? e.startsAt).getTime() < at.getTime() - 86_400_000) {
          row(e.id).visibility = "archived";
          n++;
        }
      }
      return n;
    },
    async pastLineups() {
      return store.past;
    },
  };
  return store;
}

function setup(catalog = defaultCatalog(), clock?: { now(): Date }) {
  const world = fakeEventsWorld(now);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const store = createMemoryCandidateStore();
  const time = clock ?? world.clock;
  const verification = fakeVerification(world);
  const deps = {
    validator: new ArtistValidator({
      catalog,
      artists: world.artists,
      cache: createMemoryValidationCache(),
      clock: time,
    }),
    store,
    ingest: (
      adapter: Parameters<typeof ingestEvents>[1],
      opts: Parameters<typeof ingestEvents>[2],
    ) => ingestEvents({ ...world, clock: time, logger }, adapter, opts),
    findEventId: (s: EventSource, id: string) => world.events.findIdBySourceRef(s, id),
    clock: time,
    logger,
    verification,
  };
  const run = (sources: CandidateSource[], mode: CollectMode = "hold") =>
    collectEvents(deps, sources, { mode });
  return { world, deps, store, verification, run, logger };
}

function defaultCatalog() {
  return new FakeArtistCatalog(
    Object.fromEntries(
      [...lineup, "Charlie Puth"].map((name, i) => [
        name,
        [spotifyArtist(`${i}a2b3c4d5e6f7g8h9i0j1k`.slice(0, 22), name, 0)],
      ]),
    ),
  );
}

const nameOf = (world: ReturnType<typeof fakeEventsWorld>, id: string) =>
  world.artists.artists.find((a) => a.id === id)?.name;

describe("collectEvents modes (D-055)", () => {
  it("dry-run writes nothing and reports each event's verification", async () => {
    const { world, store, run } = setup();
    const r = await run([source("sunburn", [sunburn]), source("rollingstone", [rsi])], "dry-run");
    expect(store.rows).toHaveLength(0);
    expect(world.events.events).toHaveLength(0);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ outcome: "reported", title: "Sunburn Festival 2026" });
    expect(r.events[0]!.verification.passes).toBe(true);
  });

  it("the default writes candidates only, never events", async () => {
    const { world, store, run } = setup();
    await run([source("sunburn", [sunburn]), source("rollingstone", [rsi])], "candidates");
    expect(store.rows).toHaveLength(2);
    expect(world.events.events).toHaveLength(0);
  });
});

describe("collectEvents --hold (D-056)", () => {
  it("golden: writes Sunburn 2026 Mumbai as held, with per-field provenance and the full lineup", async () => {
    const { world, verification, run } = setup();
    const r = await run([source("sunburn", [sunburn]), source("rollingstone", [rsi])]);
    expect(world.events.events).toHaveLength(1);
    const e = world.events.events[0]!;
    expect(e).toMatchObject({ title: "Sunburn Festival 2026" });
    expect(e.lineup.map((l) => nameOf(world, l.artistId))).toEqual(lineup);
    const stored = verification.rows.get(e.id)!;
    expect(stored.visibility).toBe("held");
    expect(stored.verification?.passes).toBe(true);
    expect(stored.verification?.fields.date.agreeing.map((a) => a.source)).toEqual([
      "sunburn",
      "rollingstone",
    ]);
    expect(r.events[0]).toMatchObject({ outcome: "held_new", eventId: e.id });
  });

  it("writes a single news source as held but failing, and only confirmed artists when passing", async () => {
    const { verification, world, run } = setup();
    await run([source("rollingstone", [rsi])]);
    const e = world.events.events[0]!;
    expect(verification.rows.get(e.id)?.verification?.passes).toBe(false);
  });

  it("keeps a date conflict as a candidate only", async () => {
    const { world, run } = setup();
    const r = await run([
      source("sunburn", [sunburn]),
      source("rollingstone", [
        { ...rsi, endsAt: null, startsAt: new Date("2026-12-19T00:00:00+05:30") },
      ]),
    ]);
    expect(world.events.events).toHaveLength(0);
    expect(r.events[0]?.detail).toMatch(/conflict/u);
  });

  it("golden: a Wikipedia old-Goa edition next to the organiser's Mumbai edition is held as a city conflict", async () => {
    const { world, run } = setup();
    const goa: EventCandidate = {
      ...sunburn,
      source: "wikipedia",
      externalId: "123:2026:goa",
      url: "https://en.wikipedia.org/wiki/Sunburn_Festival",
      city: "Goa",
      venueName: null,
      startsAt: new Date("2026-12-27T00:00:00+05:30"),
      endsAt: new Date("2026-12-29T00:00:00+05:30"),
      artists: ["Paul van Dyk", "Ferry Corsten", "Axwell"].map(mention),
      fingerprint: "wikipedia:123",
    };
    const r = await run([source("sunburn", [sunburn]), source("wikipedia", [goa])]);
    const goaEvent = r.events.find((e) => e.city === "Goa")!;
    const mumbai = r.events.find((e) => e.city === "Mumbai")!;
    expect(goaEvent.verification.fields.city.status).toBe("conflict");
    expect(goaEvent.detail).toMatch(/conflict/u);
    // The organiser's own city stands (D-055): Mumbai is written, Goa is not.
    expect(mumbai.verification.checks.find((c) => c.name === "series_city")?.ok).toBe(true);
    expect(world.events.events.map((e) => e.title)).toEqual(["Sunburn Festival 2026"]);
    expect(world.events.events).toHaveLength(1);
  });

  it("corroborates across runs and is idempotent", async () => {
    let t = now.getTime();
    const { world, verification, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("rollingstone", [rsi])]);
    t += 3 * 3_600_000;
    await run([source("sunburn", [sunburn])]);
    await run([source("sunburn", [sunburn])]);
    expect(world.events.events).toHaveLength(1);
    const e = world.events.events[0]!;
    expect(e.sources.map((s) => s.source).sort()).toEqual(["rollingstone", "sunburn"]);
    expect(verification.rows.get(e.id)?.verification?.fields.date.status).toBe("verified");
  });

  it("stops cleanly before writing anything when Spotify is blocked", async () => {
    const until = new Date("2026-11-21T11:00:00Z");
    const catalog = defaultCatalog().failOn("Anyma", new SpotifyBlockedError("gate_paused", until));
    const { world, store, run } = setup(catalog);
    const r = await run([source("sunburn", [sunburn])]);
    expect(r.blockedUntil).toEqual(until);
    expect(store.rows).toHaveLength(0);
    expect(world.events.events).toHaveLength(0);
  });

  it("reports a failed source and still processes the others", async () => {
    const { world, run } = setup();
    const r = await run([
      source("sunburn", [sunburn]),
      source("teaminnovation", [], new UpstreamError("teaminnovation", "HTTP 503")),
    ]);
    expect(r.sources.find((s) => s.source === "teaminnovation")?.error).toBe("HTTP 503");
    expect(world.events.events).toHaveLength(1);
  });
});

describe("publishEvents and layer 6", () => {
  it("publishes only events whose verification passes, and never past ones", async () => {
    const { world, verification, deps, run } = setup();
    await run([source("sunburn", [sunburn]), source("rollingstone", [rsi])]);
    await run([
      source("rollingstone", [
        {
          ...rsi,
          externalId: "x",
          url: "https://rollingstoneindia.com/x/",
          title: "Other Fest 2026",
          city: "Pune",
          venueName: null,
          fingerprint: "text:x",
        },
      ]),
    ]);
    const [good, weak] = world.events.events;
    const results = await publishEvents(
      deps as { verification: EventVerificationStore; clock: { now(): Date } },
      [good!.id, weak!.id, "00000000-0000-0000-0000-000000000000" as EventId],
    );
    expect(results.map((r) => r.published)).toEqual([true, false, false]);
    expect(results[1]!.reason).toMatch(/^fails:/u);
    expect(verification.rows.get(good!.id)?.visibility).toBe("published");
    expect(verification.rows.get(weak!.id)?.visibility).toBe("held");
  });

  it("moves a published event back to held when its official listing disappears", async () => {
    let t = now.getTime();
    const { world, verification, deps, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("teaminnovation", [teamInnovation])]);
    const e = world.events.events[0]!;
    await publishEvents(deps, [e.id]);
    expect(verification.rows.get(e.id)?.visibility).toBe("published");
    t += 3 * 3_600_000;
    const r = await run([source("teaminnovation", [])]);
    expect(verification.rows.get(e.id)?.visibility).toBe("held");
    expect(r.events[0]).toMatchObject({
      outcome: "unpublished",
      detail: "no longer listed by teaminnovation",
    });
  });

  it("moves a published event back to held when a conflict appears", async () => {
    let t = now.getTime();
    const { world, verification, deps, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("sunburn", [sunburn])]);
    const e = world.events.events[0]!;
    await publishEvents(deps, [e.id]);
    t += 3_600_000;
    await run([
      source("sunburn", [sunburn]),
      source("rollingstone", [
        { ...rsi, endsAt: null, startsAt: new Date("2026-12-19T00:00:00+05:30") },
      ]),
    ]);
    expect(verification.rows.get(e.id)?.visibility).toBe("held");
  });

  it("archives events whose date has passed", async () => {
    let t = now.getTime();
    const { world, verification, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("sunburn", [sunburn])]);
    t = new Date("2027-01-05T00:00:00Z").getTime();
    const r = await run([]);
    expect(r.archived).toBe(1);
    expect(verification.rows.get(world.events.events[0]!.id)?.visibility).toBe("archived");
  });
});

describe("D-060 cadence, cleanup and cancellations", () => {
  it("re-verifies an untouched stored event only when it is due (by proximity)", async () => {
    let t = now.getTime();
    const { world, verification, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("sunburn", [sunburn])]);
    const id = world.events.events[0]!.id;
    const first = verification.rows.get(id)!.lastVerifiedAt;
    // Sunburn is ~27 days out: every 6 hours.
    t += 3 * 3_600_000;
    const early = await run([]);
    expect(early.notDue).toBe(1);
    expect(verification.rows.get(id)!.lastVerifiedAt).toEqual(first);
    t += 3 * 3_600_000;
    const due = await run([]);
    expect(due.notDue).toBe(0);
    expect(due.events.map((e) => e.title)).toEqual(["Sunburn Festival 2026"]);
  });

  it("deletes candidates not seen for 30 days", async () => {
    let t = now.getTime();
    const { store, run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("rollingstone", [rsi])], "candidates");
    expect(store.rows).toHaveLength(1);
    t += 31 * 86_400_000;
    const r = await run([]);
    expect(r.candidatesDeleted).toBe(1);
    expect(store.rows).toHaveLength(0);
  });

  it("an organiser's cancellation flags the event and stores it as cancelled", async () => {
    const { world, run } = setup();
    const r = await run([source("sunburn", [{ ...sunburn, cancelled: true }])]);
    expect(r.events[0]!.verification.flags).toContain("cancelled");
    expect(world.events.events[0]!.status).toBe("cancelled");
  });

  it("a single outlet's 'cancelled' headline alone does not cancel", async () => {
    const { run } = setup();
    const r = await run([
      source("sunburn", [sunburn]),
      source("rollingstone", [{ ...rsi, cancelled: true }]),
    ]);
    expect(r.events[0]!.verification.flags).not.toContain("cancelled");
  });

  it("tells sources which stored events still lack a confirmed lineup", async () => {
    let t = now.getTime();
    const { run } = setup(defaultCatalog(), { now: () => new Date(t) });
    await run([source("sunburn", [{ ...sunburn, artists: [] }])]);
    t += 3_600_000;
    const seen: (readonly string[] | undefined)[] = [];
    const spy: CandidateSource = {
      source: "rollingstone",
      async *collect(opts) {
        seen.push(opts.focus);
      },
    };
    const r = await run([spy]);
    expect(r.focus).toEqual(["Sunburn Festival 2026"]);
    expect(seen).toEqual([["Sunburn Festival 2026"]]);
  });
});

describe("doubt resolver in the collector (D-062, D-064)", () => {
  const djmag = {
    url: "https://djmag.com/news/sunburn-festival-2026-full-line-up-announced",
    title: "Sunburn Festival 2026 full line-up announced",
    content:
      "Sunburn Festival 2026 full line-up announced. It takes place at Mahalaxmi Racecourse in Mumbai on December 18 and 19, 2026. Headlining are DJ Snake, Sebastian Ingrosso and The Chainsmokers.",
  };
  const reply = {
    title: "Sunburn Festival 2026",
    startDate: "2026-12-18",
    endDate: "2026-12-19",
    city: "Mumbai",
    venue: "Mahalaxmi Racecourse",
    headliners: ["DJ Snake", "Sebastian Ingrosso", "The Chainsmokers"],
    support: [],
    quotes: {
      title: "Sunburn Festival 2026 full line-up announced",
      startDate: "on December 18 and 19, 2026",
      city: "Mahalaxmi Racecourse in Mumbai",
      venue: "at Mahalaxmi Racecourse",
      headliners: "Headlining are DJ Snake, Sebastian Ingrosso and The Chainsmokers",
    },
  };

  function withResolver(doubtOnly?: string[]) {
    const ctx = setup();
    const search = vi.fn(async () => [djmag]);
    const extract = vi.fn(async () => reply);
    const usage = new Map<string, { searches: number; modelCalls: number }>();
    const doubt = new DoubtResolver({
      search: { search },
      extractor: { extract },
      fetchPage: async () => djmag.content,
      store: {
        usage: async (d) => usage.get(d) ?? { searches: 0, modelCalls: 0 },
        addUsage: async () => {},
        cached: async () => undefined,
        cache: async () => {},
      },
      clock: ctx.deps.clock,
      logger: ctx.logger,
    });
    const run = (sources: CandidateSource[]) =>
      collectEvents({ ...ctx.deps, doubt, doubtOnly }, sources, { mode: "hold" });
    return { ...ctx, run, search, extract };
  }

  it("a held event missing its lineup is corroborated by a grounded outlet page", async () => {
    const { run, verification, world } = withResolver();
    const listing = { ...sunburn, artists: [] };
    const outlet = { ...rsi, artists: lineup.slice(0, 3).map(mention) };
    const r = await run([source("sunburn", [listing]), source("rollingstone", [outlet])]);
    const e = r.events.find((x) => x.title === "Sunburn Festival 2026")!;
    expect(r.doubt?.notes[0]?.reasons).toEqual(["lineup single"]);
    expect(e.sources.map((s) => s.url)).toContain(djmag.url);
    expect(e.verification.fields.headliners.status).toBe("verified");
    expect(e.verification.passes).toBe(true);
    // Only artists two independent sources name are stored.
    const stored = world.events.events[0]!;
    expect(
      stored.lineup.map((l) => world.artists.artists.find((a) => a.id === l.artistId)?.name),
    ).toEqual(["DJ Snake", "Sebastian Ingrosso", "The Chainsmokers"]);
    expect(verification.rows.get(stored.id)?.verification?.passes).toBe(true);
  });

  it("is not consulted for events outside --doubt-only or not in doubt", async () => {
    const { run, search } = withResolver(["HOME Festival"]);
    await run([source("sunburn", [{ ...sunburn, artists: [] }])]);
    expect(search).not.toHaveBeenCalled();
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createEventsUseCases,
  SearchPageParamsSchema,
  SuggestParamsSchema,
  type SearchGroups,
  type SuggestResponse,
} from "@/application/events";
import { AdminEventInputSchema } from "@/application/events/save-admin-event";
import { analyticsEvents, artists, devices, eventArtists, events, venues } from "@/db/schema";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { testDb } from "../../../tests/setup/db";
import { PgArtistRepository } from "./artist-repository";
import { PgEventRepository } from "./event-repository";
import { PgEventSearch } from "./event-search";
import { PgEventStatsRollup } from "./event-stats-repository";
import { truncateEventTables } from "./events-test-db";
import { PgIngestRunRepository } from "./ingest-run-repository";
import { PgSearchLogRepository } from "./search-log-repository";
import { PgVenueRepository } from "./venue-repository";

const db = testDb();
/** Wednesday 25 Nov 2026, 11:30 IST: "this weekend" is Fri 27 – Sun 29 Nov. */
const now = new Date("2026-11-25T06:00:00Z");
const artistRepo = new PgArtistRepository(db);
const useCases = createEventsUseCases({
  events: new PgEventRepository(db),
  venues: new PgVenueRepository(db),
  artists: artistRepo,
  ingestRuns: new PgIngestRunRepository(db),
  search: new PgEventSearch(db),
  statsRollup: new PgEventStatsRollup(db),
  searchLog: new PgSearchLogRepository(db),
  clock: { now: () => now },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});
afterAll(() => db.$close());

const typed = async (q: string, city?: string): Promise<SearchGroups> => {
  const res: SuggestResponse = await useCases.suggest(
    SuggestParamsSchema.parse({ q, ...(city ? { city } : {}) }),
  );
  if (!("results" in res)) throw new Error("expected typed results");
  return res;
};
const titles = (r: SearchGroups) => r.results.map((e) => e.title);
const top = (r: SearchGroups) => {
  const e = r.results[0];
  return e && [e.title, e.matchReason, e.matchedText, e.matchedArtist ?? null];
};

type Seed = {
  title: string;
  type?: "concert" | "festival";
  startsAt: string;
  endsAt?: string;
  genre?: string;
  venue: [name: string, city: string];
  lineup: string[];
};

const SEEDS: Seed[] = [
  {
    title: "Bacardi NH7 Weekender",
    type: "festival",
    startsAt: "2026-12-12T10:00:00Z",
    venue: ["Mahalakshmi Lawns", "Pune"],
    lineup: ["The Local Train", "Ritviz"],
  },
  {
    title: "Lollapalooza India 2027",
    type: "festival",
    startsAt: "2027-03-06T08:30:00Z",
    genre: "Rock",
    venue: ["Mahalaxmi Racecourse", "Mumbai"],
    lineup: ["Green Day", "Anuv Jain"],
  },
  {
    title: "Lollapalooza India 2028",
    type: "festival",
    startsAt: "2028-03-04T08:30:00Z",
    genre: "Rock",
    venue: ["Mahalaxmi Racecourse", "Mumbai"],
    lineup: ["Glass Animals"],
  },
  {
    title: "Sunburn Arena ft. Alan Walker",
    startsAt: "2026-12-19T14:00:00Z",
    genre: "Dance/Electronic",
    venue: ["NSCI Dome", "Bombay"],
    lineup: ["Alan Walker"],
  },
  {
    title: "Sunburn Goa 2025",
    type: "festival",
    startsAt: "2025-12-28T10:00:00Z",
    endsAt: "2025-12-30T18:00:00Z",
    venue: ["Vagator Beach", "Goa"],
    lineup: ["Martin Garrix"],
  },
  {
    title: "Supersonic 2027",
    type: "festival",
    startsAt: "2027-02-14T10:00:00Z",
    venue: ["Mahalakshmi Lawns", "Pune"],
    lineup: ["Nucleya"],
  },
  {
    title: "Dil-Luminati Tour",
    startsAt: "2026-12-20T14:00:00Z",
    venue: ["Jawaharlal Nehru Stadium", "New Delhi"],
    lineup: ["Diljit Dosanjh", "Jasmine Sandlas"],
  },
  {
    title: "Dil-Luminati Tour Bengaluru",
    startsAt: "2027-01-10T14:00:00Z",
    venue: ["Palace Grounds", "Bangalore"],
    lineup: ["Diljit Dosanjh"],
  },
  {
    title: "दिलजीत दोसांझ लाइव",
    startsAt: "2027-01-20T14:00:00Z",
    venue: ["Bhartiya City", "Bengaluru"],
    lineup: ["दिलजीत दोसांझ"],
  },
  {
    title: "Beyoncé Renaissance",
    startsAt: "2027-02-01T14:00:00Z",
    venue: ["DY Patil Stadium", "Navi Mumbai"],
    lineup: ["Beyoncé"],
  },
  {
    title: "100% Bollywood Night",
    startsAt: "2026-12-31T14:00:00Z",
    genre: "Bollywood",
    venue: ["Hard Rock Cafe", "Pune"],
    lineup: ["Shaan"],
  },
  {
    title: "Silhouettes Tour",
    startsAt: "2026-12-05T14:00:00Z",
    genre: "Indie",
    venue: ["Phoenix Marketcity", "Bengaluru"],
    lineup: ["Prateek Kuhad"],
  },
  {
    title: "Arijit Singh Live",
    startsAt: "2027-01-15T14:00:00Z",
    venue: ["Gachibowli Stadium", "Hyderabad"],
    lineup: ["Arijit Singh"],
  },
  {
    title: "Paagal Tour",
    startsAt: "2027-01-22T14:00:00Z",
    venue: ["Siri Fort", "Delhi"],
    lineup: ["Badshah"],
  },
  {
    title: "Indie Night Out",
    startsAt: "2026-11-28T13:30:00Z",
    genre: "Indie",
    venue: ["Hard Rock Cafe", "Pune"],
    lineup: ["When Chai Met Toast"],
  },
];

const ids: Record<string, string> = {};

async function seed() {
  await truncateEventTables(db);
  await db.execute(sql`truncate table search_log, event_stats, analytics_events, devices cascade`);
  for (const s of SEEDS) {
    const { event } = await useCases.createAdminEvent(
      AdminEventInputSchema.parse({
        title: s.title,
        type: s.type ?? "concert",
        startsAt: s.startsAt,
        endsAt: s.endsAt ?? null,
        genre: s.genre ?? null,
        venue: { name: s.venue[0], city: s.venue[1], country: "IN" },
        lineup: s.lineup.map((name) => ({ name, tier: "headliner" })),
        visibility: "published",
        posterUrl: "https://example.org/poster.jpg",
      }),
    );
    ids[s.title] = event.id;
  }
  const kuhad = await artistRepo.findByAlias("prateek kuhad");
  await artistRepo.recordMatch(kuhad!.id, {
    spotifyId: asSpotifyArtistId("0tC995Rfn9k2l7nqgCZsV7"),
    score: 95,
    status: "auto",
    imageUrl: "https://i.scdn.co/image/kuhad.jpg",
    resolvedAt: now,
  });
}

describe("search on real Postgres (D-047 issues)", () => {
  beforeAll(seed);

  it("1. 'lo' matches title starts, not the artist 'The Local Train'", async () => {
    const r = await typed("lo");
    expect(top(r)).toEqual(["Lollapalooza India 2027", "title", "Lo", null]);
    expect(titles(r)).not.toContain("Bacardi NH7 Weekender");
    expect(r.artists).toEqual([]);
  });

  it.each<[string, string[], Record<string, unknown>]>([
    [
      // QA-F-4: "concerts" means any live event, festivals included.
      "concerts in pune",
      ["Indie Night Out", "Bacardi NH7 Weekender", "100% Bollywood Night", "Supersonic 2027"],
      { city: "Pune" },
    ],
    [
      "gigs in pune",
      ["Indie Night Out", "Bacardi NH7 Weekender", "100% Bollywood Night", "Supersonic 2027"],
      { city: "Pune" },
    ],
    ["lolla mumbai", ["Lollapalooza India 2027", "Lollapalooza India 2028"], { city: "Mumbai" }],
  ])("2. %j parses the city as a filter", async (q, expected, filters) => {
    const r = await typed(q);
    expect(titles(r)).toEqual(expected);
    expect(r.filters).toEqual(filters);
  });

  it("3. 'this weekend' is a date filter, not a fuzzy 'Weekender'", async () => {
    const r = await typed("this weekend");
    expect(titles(r)).toEqual(["Indie Night Out"]);
    expect(r.filters).toEqual({
      from: new Date("2026-11-26T18:30:00Z"),
      to: new Date("2026-11-29T18:29:59.999Z"),
    });
  });

  it("4. 'december' finds NH7 (12 Dec)", async () => {
    const r = await typed("december");
    expect(titles(r)).toEqual(
      expect.arrayContaining([
        "Bacardi NH7 Weekender",
        "Silhouettes Tour",
        "Sunburn Arena ft. Alan Walker",
      ]),
    );
    expect(titles(r)).not.toContain("Lollapalooza India 2027");
  });

  it.each<[string, string[]]>([
    [
      "festival",
      [
        "Bacardi NH7 Weekender",
        "Supersonic 2027",
        "Lollapalooza India 2027",
        "Lollapalooza India 2028",
      ],
    ],
    ["edm", ["Sunburn Arena ft. Alan Walker"]],
    ["indie", ["Indie Night Out", "Silhouettes Tour"]],
  ])("5. %j filters by type or genre", async (q, expected) => {
    expect(titles(await typed(q))).toEqual(expected);
  });

  it("5. a genre with no events returns empty results plus a fallback", async () => {
    const r = await typed("techno");
    expect(r.results).toEqual([]);
    expect(r.filters).toEqual({ genre: "techno" });
    expect(r.fallback?.length).toBeGreaterThan(0);
  });

  it.each(["NH 7", "nh7", "nh 7 weekender"])("6. %j finds NH7", async (q) => {
    expect(titles(await typed(q))[0]).toBe("Bacardi NH7 Weekender");
  });

  it("7. 'prateek' puts the artist entity first, then the event", async () => {
    const r = await typed("prateek");
    expect(r.artists).toEqual([
      {
        id: expect.any(String),
        name: "Prateek Kuhad",
        spotifyId: "0tC995Rfn9k2l7nqgCZsV7",
        imageUrl: "https://i.scdn.co/image/kuhad.jpg",
        upcomingCount: 1,
        matchedText: "Prateek",
        // QA-F-1: one upcoming show, so the artist row links straight to it.
        onlyEventId: ids["Silhouettes Tour"],
      },
    ]);
    expect(top(r)).toEqual(["Silhouettes Tour", "artist", "Prateek Kuhad", "Prateek Kuhad"]);
  });

  it("7. city entities: 'pune' and a city prefix", async () => {
    expect((await typed("pune")).cities).toEqual([{ city: "Pune", upcomingCount: 4 }]);
    expect((await typed("beng")).cities).toEqual([{ city: "Bengaluru", upcomingCount: 3 }]);
  });

  it.each(["coldplay", "sunbrun goa 2031"])("8. %j never dead-ends", async (q) => {
    const r = await typed(q);
    expect(r.results).toEqual([]);
    expect(r.fallback?.length).toBeGreaterThan(0);
    expect(r.fallback?.[0]).toMatchObject({ matchReason: "title", matchedText: "" });
  });

  it.each<[string, string, string]>([
    ["diljeet", "Dil-Luminati Tour", "Diljit Dosanjh"],
    ["arjit", "Arijit Singh Live", "Arijit Singh"],
    ["badshaah", "Paagal Tour", "Badshah"],
  ])("11. phonetic %j → %s (%s)", async (q, title, artist) => {
    const r = await typed(q);
    expect(r.results[0]).toMatchObject({ title, matchedArtist: artist });
    expect(r.artists[0]?.name).toBe(artist);
  });

  it.each<[string, string, string, string]>([
    ["typo", "lolapalooza", "Lollapalooza India 2027", "fuzzy"],
    ["typo, short word", "sunbrn", "Sunburn Arena ft. Alan Walker", "fuzzy"],
    ["diacritics", "beyonce", "Beyoncé Renaissance", "title"],
    ["devanagari", "दिलजीत", "दिलजीत दोसांझ लाइव", "title"],
    ["venue", "palace grounds", "Dil-Luminati Tour Bengaluru", "venue"],
    ["city alias", "bombay", "Sunburn Arena ft. Alan Walker", "city"],
    ["nickname", "vh1", "Supersonic 2027", "alias"],
    ["literal percent", "100%", "100% Bollywood Night", "title"],
  ])("%s: %j", async (_label, q, title, reason) => {
    expect((await typed(q)).results[0]).toMatchObject({ title, matchReason: reason });
  });

  it("excludes events that have ended", async () => {
    expect(titles(await typed("sunburn"))).not.toContain("Sunburn Goa 2025");
  });

  it.each(["%%", "__", "'; drop table events; --", "\\\\", "' OR 1=1 --"])(
    "treats %j as plain text",
    async (q) => {
      await expect(typed(q)).resolves.toBeDefined();
      const [{ count }] = (await db.execute(
        sql`select count(*)::int as count from events`,
      )) as unknown as [{ count: number }];
      expect(count).toBe(SEEDS.length);
    },
  );

  it("rejects a 1-character query", () => {
    expect(SuggestParamsSchema.safeParse({ q: "s" }).success).toBe(false);
  });
});

describe("popularity and recommendations on real Postgres (issues 9, 10)", () => {
  beforeAll(seed);

  it("analytics opens and search click-throughs feed trend, which breaks ties (QA-F-7)", async () => {
    const lolla = async () => titles(await typed("lollapalooza"));
    expect(await lolla()).toEqual(["Lollapalooza India 2027", "Lollapalooza India 2028"]);
    const lolla2028 = ids["Lollapalooza India 2028"]!;
    const device = "20000000-0000-4000-8000-000000000001";
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    await db
      .insert(devices)
      .values({ id: device, firstSeen: ago(60), lastSeen: ago(1), firstSource: "direct" });
    await db.insert(analyticsEvents).values([
      {
        deviceId: device,
        name: "search",
        props: { q: "lollapalooza", results: 2 },
        source: "direct",
        at: ago(10),
      },
      {
        deviceId: device,
        name: "event_open",
        props: { eventId: lolla2028 },
        source: "direct",
        at: ago(5),
      },
      {
        deviceId: null,
        name: "event_open",
        props: { eventId: lolla2028 },
        source: "direct",
        at: ago(1),
      },
    ]);
    expect(await useCases.rollupEventStats()).toEqual({ events: 1 });
    expect(await lolla()).toEqual(["Lollapalooza India 2028", "Lollapalooza India 2027"]);

    const [stats] = (await db.execute(
      sql`select views, search_clicks, trend_score from event_stats where event_id = ${lolla2028}::uuid`,
    )) as unknown as [{ views: number; search_clicks: number; trend_score: number }];
    expect(stats).toMatchObject({ views: 1, search_clicks: 1 });
    expect(stats.trend_score).toBeCloseTo(4, 2);
  });

  it("an empty query returns de-duplicated sections of at most 5", async () => {
    await useCases.searchPage(SearchPageParamsSchema.parse({ q: "lolla" }));
    const res = await useCases.suggest(SuggestParamsSchema.parse({ city: "poona" }));
    if (!("sections" in res)) throw new Error("expected sections");
    const byId = Object.fromEntries(
      res.sections.map((s) => [s.id, "items" in s ? s.items.map((i) => i.title) : s.queries]),
    );
    expect(Object.keys(byId)).toEqual([
      "trending",
      "this_weekend",
      "near_you",
      "up_next",
      "popular_searches",
    ]);
    // Only events with engagement trend; the rest of the panel is calendar-driven.
    expect(byId.trending).toEqual(["Lollapalooza India 2028"]);
    expect(byId.this_weekend).toEqual(["Indie Night Out"]);
    expect(byId.near_you).toEqual([
      "Bacardi NH7 Weekender",
      "100% Bollywood Night",
      "Supersonic 2027",
    ]);
    // QA-F-6: searches people made (analytics and committed searches), then event titles;
    // every chip is checked to return something.
    const chips = byId.popular_searches as string[];
    expect(chips.slice(0, 2)).toEqual(["lolla", "lollapalooza"]);
    expect(chips.length).toBeLessThanOrEqual(5);
    for (const chip of chips) expect((await typed(chip)).results.length).toBeGreaterThan(0);
    const all = res.sections.flatMap((s) => ("items" in s ? s.items.map((i) => i.id) : []));
    expect(new Set(all).size).toBe(all.length);
    for (const s of res.sections) if ("items" in s) expect(s.items.length).toBeLessThanOrEqual(5);
  });
});

describe("GET /api/search engine (D-048)", () => {
  beforeAll(seed);

  it("artist= lists every upcoming show of that artist", async () => {
    const r = await useCases.searchPage(SearchPageParamsSchema.parse({ artist: "Diljit Dosanjh" }));
    expect(r.results.map((e) => [e.title, e.matchReason, e.matchedArtist])).toEqual([
      ["Dil-Luminati Tour", "artist", "Diljit Dosanjh"],
      ["Dil-Luminati Tour Bengaluru", "artist", "Diljit Dosanjh"],
    ]);
    expect(r.artists.map((a) => [a.name, a.upcomingCount])).toEqual([["Diljit Dosanjh", 2]]);
    expect(r.total).toBe(2);
  });

  it("city= with paging and total", async () => {
    const page1 = await useCases.searchPage(
      SearchPageParamsSchema.parse({ city: "Pune", pageSize: "3" }),
    );
    const page2 = await useCases.searchPage(
      SearchPageParamsSchema.parse({ city: "Pune", pageSize: "3", page: "2" }),
    );
    expect(page1.total).toBe(4);
    expect(page1.results).toHaveLength(3);
    expect(page2.results).toHaveLength(1);
    expect(new Set([...page1.results, ...page2.results].map((e) => e.id)).size).toBe(4);
    expect(page1.cities).toEqual([{ city: "Pune", upcomingCount: 4 }]);
  });

  it("text plus explicit filters", async () => {
    const r = await useCases.searchPage(
      SearchPageParamsSchema.parse({ q: "night", city: "Pune", to: "2026-11-30" }),
    );
    expect(r.results.map((e) => e.title)).toEqual(["Indie Night Out"]);
  });
});

describe("D-056: only published events reach users", () => {
  beforeAll(async () => {
    await seed();
    // Look-alikes of published events that must never surface.
    for (const [title, visibility] of [
      ["Prateek Kuhad Secret Show", "held"],
      ["Prateek Kuhad Farewell", "archived"],
    ] as const) {
      const { event } = await useCases.createAdminEvent(
        AdminEventInputSchema.parse({
          title,
          type: "concert",
          startsAt: "2026-12-08T14:00:00Z",
          venue: { name: "Hard Rock Cafe", city: "Pune", country: "IN" },
          lineup: [{ name: "Prateek Kuhad", tier: "headliner" }],
          visibility,
        }),
      );
      ids[title] = event.id;
    }
  });

  it.each(["prateek", "secret show", "farewell", "gigs in pune", "december"])(
    "typed %j never returns held or archived events",
    async (q) => {
      const r = await typed(q);
      expect(titles(r)).not.toContain("Prateek Kuhad Secret Show");
      expect(titles(r)).not.toContain("Prateek Kuhad Farewell");
      expect((r.fallback ?? []).map((e) => e.title)).not.toContain("Prateek Kuhad Secret Show");
    },
  );

  it("artist and city counts only count published shows", async () => {
    expect((await typed("prateek")).artists[0]?.upcomingCount).toBe(1);
    expect((await typed("pune")).cities).toEqual([{ city: "Pune", upcomingCount: 4 }]);
  });

  it("the results page and its artist filter skip them", async () => {
    const r = await useCases.searchPage(SearchPageParamsSchema.parse({ artist: "Prateek Kuhad" }));
    expect(r.results.map((e) => e.title)).toEqual(["Silhouettes Tour"]);
  });

  it("zero-query sections skip them, even with engagement on record", async () => {
    await db.execute(sql`
      insert into event_stats (event_id, views, trend_score, trend_updated_at)
      values (${ids["Prateek Kuhad Secret Show"]}::uuid, 50, 999, now())`);
    const res = await useCases.suggest(SuggestParamsSchema.parse({ city: "Pune" }));
    if (!("sections" in res)) throw new Error("expected sections");
    const listed = res.sections.flatMap((s) => ("items" in s ? s.items.map((i) => i.title) : []));
    expect(listed).not.toContain("Prateek Kuhad Secret Show");
    expect(listed).not.toContain("Prateek Kuhad Farewell");
  });

  it("opens of hidden events never give them stats (D-056)", async () => {
    const hidden = [ids["Prateek Kuhad Secret Show"]!, ids["Prateek Kuhad Farewell"]!];
    await db.insert(analyticsEvents).values(
      hidden.map((eventId) => ({
        deviceId: null,
        name: "event_open",
        props: { eventId },
        source: "direct",
        at: now,
      })),
    );
    await useCases.rollupEventStats();
    const rows = await db.execute(
      sql`select event_id::text from event_stats where trend_score > 0 and event_id::text = any(array[${sql.join(
        hidden.map((h) => sql`${h}`),
        sql`, `,
      )}]::text[])`,
    );
    expect([...rows]).toEqual([]);
  });

  it("an artist who only plays hidden events is never suggested (QA-E-4)", async () => {
    await useCases.createAdminEvent(
      AdminEventInputSchema.parse({
        title: "Mystery Gig",
        type: "concert",
        startsAt: "2026-12-09T14:00:00Z",
        venue: { name: "Hard Rock Cafe", city: "Pune", country: "IN" },
        lineup: [{ name: "Quixotrel Heldonly", tier: "headliner" }],
      }),
    );
    for (const q of ["Quixotrel", "Quixotrel Heldonly", "quixotrl heldonli"]) {
      const r = await typed(q);
      expect(r.results).toEqual([]);
      expect(r.artists).toEqual([]);
      expect(r.didYouMean).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain("Quixotrel");
    }
  });
});

describe("timing on ~2,000 events (D-047: typed p95 < 100 ms, zero-query p95 < 150 ms)", () => {
  const WORDS = [
    "Sunburn",
    "Arena",
    "Weekender",
    "Live",
    "Tour",
    "Night",
    "Festival",
    "Unplugged",
    "Sessions",
    "Fest",
  ];
  const GENRES = ["Rock", "Dance/Electronic", "Indie", "Hip-Hop/Rap", null];
  const CITIES = ["Mumbai", "Bengaluru", "Delhi", "Pune", "Goa", "Hyderabad", "Chennai", "Kolkata"];

  beforeAll(async () => {
    await truncateEventTables(db);
    await db.execute(
      sql`truncate table search_log, event_stats, analytics_events, devices cascade`,
    );
    const vs = await db
      .insert(venues)
      .values(
        CITIES.flatMap((city, c) =>
          Array.from({ length: 5 }, (_, i) => ({
            name: i === 0 ? "Mahalaxmi Racecourse" : `Venue ${c}-${i} Grounds`,
            normalizedName: i === 0 ? "mahalaxmi racecourse" : `venue ${c} ${i} ground`,
            city,
            country: "IN",
          })),
        ),
      )
      .returning({ id: venues.id });
    const as = await db
      .insert(artists)
      .values(
        Array.from({ length: 600 }, (_, i) => ({
          name: `Artist ${i} Kumar`,
          normalizedName: `artist ${i} kumar`,
        })),
      )
      .returning({ id: artists.id });
    const base = Date.parse("2026-11-26T14:00:00Z");
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      title: `${WORDS[i % 10]} ${WORDS[(i * 7) % 10]} ${i}`,
      type: (i % 4 === 0 ? "festival" : "concert") as "festival" | "concert",
      genre: GENRES[i % GENRES.length],
      venueId: vs[i % vs.length]!.id,
      startsAt: new Date(base + (i % 400) * 86_400_000),
      dedupeKey: `perf-${i}`,
      visibility: "published" as const,
    }));
    const evs: { id: string }[] = [];
    for (let i = 0; i < rows.length; i += 500) {
      evs.push(
        ...(await db
          .insert(events)
          .values(rows.slice(i, i + 500))
          .returning({ id: events.id })),
      );
    }
    const lineup = evs.flatMap((e, i) =>
      Array.from({ length: 5 }, (_, k) => ({
        eventId: e.id,
        artistId: as[(i * 5 + k) % as.length]!.id,
        billingRank: k + 1,
        tier: "mid" as const,
      })),
    );
    for (let i = 0; i < lineup.length; i += 2000)
      await db.insert(eventArtists).values(lineup.slice(i, i + 2000));
    await db.execute(sql`
      insert into event_stats (event_id, views, trend_score, trend_updated_at)
      select id, 3, random() * 10, now() from events where random() < 0.3`);
    await db.execute(sql`
      insert into search_log (query_normalized, results_count, created_at)
      select 'query ' || (g % 50), 3, now() - make_interval(days => g % 10) from generate_series(1, 2000) g`);
    await db.execute(sql`analyze`);
  }, 60_000);

  async function p95(run: () => Promise<unknown>, rounds: number): Promise<number> {
    await run(); // warm-up
    const times: number[] = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      await run();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.ceil(times.length * 0.95) - 1]!;
  }

  it("typed suggest and the results page", async () => {
    const queries = [
      "sunb",
      "weekender",
      "sunbrn",
      "lolla",
      "artist 42",
      "artst 42",
      "mumbai",
      "venue 3",
      "fest 99",
      "unpluged",
      "edm",
      "coldplay",
      "mahalaxmi",
      "diljeet",
      "this weekend",
      "gigs in pune",
      "lo",
      "december",
      "festival",
      "NH 7",
    ];
    let i = 0;
    const typedP95 = await p95(() => typed(queries[i++ % queries.length]!), queries.length * 3);
    let j = 0;
    const pageP95 = await p95(
      () =>
        useCases.searchPage(
          SearchPageParamsSchema.parse({ q: queries[j++ % queries.length]!, pageSize: "50" }),
        ),
      queries.length * 2,
    );
    console.warn(
      `typed suggest p95: ${typedP95.toFixed(1)} ms; /api/search p95: ${pageP95.toFixed(1)} ms`,
    );
    expect(typedP95).toBeLessThan(100);
    expect(pageP95).toBeLessThan(100);
  });

  it("zero-query recommendations", async () => {
    const zeroP95 = await p95(
      () => useCases.suggest(SuggestParamsSchema.parse({ city: "Pune" })),
      30,
    );
    console.warn(`zero-query p95: ${zeroP95.toFixed(1)} ms`);
    expect(zeroP95).toBeLessThan(150);
  });
});

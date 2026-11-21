import type { EventVisual } from "@/domain/events/publish-visual";
import { describe, expect, it, vi } from "vitest";
import { ingestEvents } from "@/application/events/ingest-events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";
import type { DoubtStore } from "@/application/ingestion/doubt-resolver";
import type { EventVerificationStore, EventVisibility } from "@/application/ingestion/ports";
import type { WebPage, WebSearch } from "@/application/ports/web-search";
import type { Verification } from "@/domain/events/extract/verify";
import type { GateSource } from "@/domain/gigs/auto-publish";
import { extractArtistGigs, isoDate } from "@/domain/gigs/extract";
import type { ValidatedGig } from "@/domain/gigs/nights";
import type { EventId } from "@/domain/shared/ids";
import type { EventSource, MatchStatus } from "@/domain/shared/lineup";
import { ArtistGigDiscovery } from "./discover-artist-gigs";
import type { AuditEntry, GateRecord, GigLead, PageReader, ReadResult } from "./ports";
import { publishDueCandidates } from "./publish-due-candidates";
import { reverifyAutoPublished } from "./reverify-published";
import { artistsForRun, runListings } from "./run-discovery";

const now = new Date("2026-11-21T10:00:00Z");
const clock = { now: () => now };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function memoryBudget(): DoubtStore & { searches: number } {
  const store = {
    searches: 0,
    async usage() {
      return { searches: store.searches, modelCalls: 0 };
    },
    async addUsage(_day: string, d: { searches?: number }) {
      store.searches += d.searches ?? 0;
    },
    async cached() {
      return undefined;
    },
    async cache() {},
  };
  return store;
}

const ok = (
  url: string,
  text: string,
  extra: Partial<ReadResult & { status: "ok" }> = {},
): ReadResult => ({
  status: "ok",
  url,
  title: "",
  text,
  jsonLd: [],
  tourLinks: [],
  ...extra,
});

function reader(pages: Record<string, ReadResult | Error>): PageReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async read(url) {
      calls.push(url);
      const page = pages[url];
      if (!page) throw new Error(`no fake page for ${url}`);
      if (page instanceof Error) throw page;
      return page;
    },
  };
}

const searchReturning = (pages: WebPage[]): WebSearch & { queries: string[] } => {
  const queries: string[] = [];
  return {
    queries,
    async search(q) {
      queries.push(q);
      return pages;
    },
  };
};

const SITE = "https://bhuwin.example.com/";
const TOUR = "https://bhuwin.example.com/live";
const BMS = "https://in.bookmyshow.com/events/sketchbook-by-bhuwin-khursija/et9ppluaao";
const RSI = "https://www.rollingstoneindia.com/bhuwin-sketchbook-mumbai/";
const TOUR_TEXT = [
  "Bhuwin",
  "Sketchbook — Unfinished Notes / Loops / Songs",
  "Mumbai | 05th, 06th & 09th December 2026 | 7:30 PM",
].join("\n");

describe("ArtistGigDiscovery", () => {
  function discovery(pages: Record<string, ReadResult | Error>, results: WebPage[], caps = 30) {
    const leads: GigLead[] = [];
    const search = searchReturning(results);
    const r = reader(pages);
    const budget = memoryBudget();
    const d = new ArtistGigDiscovery({
      search,
      reader: r,
      officialSites: { sitesOf: async () => [SITE] },
      leads: { upsert: async (l) => void leads.push(l) },
      budget,
      clock,
      logger,
      caps: { searchesPerDay: caps },
    });
    return { d, leads, search, reader: r, budget };
  }
  const bhuwin = {
    name: "Bhuwin",
    key: "bhuwin",
    spotifyId: "6vsLn0UxL3GhtYP7ghpF3t",
    origins: ["searched" as const],
    score: 3,
  };

  it("reads the official site and its tour page, and splits the run into nights", async () => {
    const { d } = discovery(
      { [SITE]: ok(SITE, "Bhuwin\nMusic", { tourLinks: [TOUR] }), [TOUR]: ok(TOUR, TOUR_TEXT) },
      [],
    );
    const { candidates } = await d.discover(bhuwin);
    expect(candidates.map((c) => [c.source, isoDate(c.startsAt), c.provenance.startTime])).toEqual([
      ["artist_site", "2026-12-05", "19:30"],
      ["artist_site", "2026-12-06", "19:30"],
      ["artist_site", "2026-12-09", "19:30"],
    ]);
  });

  it("never fetches a denied site from search; keeps only its URL and title as a lead", async () => {
    const {
      d,
      leads,
      reader: r,
    } = discovery({ [SITE]: ok(SITE, "Bhuwin") }, [
      {
        url: BMS,
        title: "Sketchbook by Bhuwin Khursija music-shows Event Tickets Mumbai",
        content: "Sat 5 Dec 2026 - Wed 9 Dec 2026 · 7:30 PM",
      },
      {
        url: "https://linktr.ee/bhuwin",
        title: "Tours Official Music",
        content: "Mumbai | 5th, 6th and 9th December",
      },
      // A show that's over is not a lead.
      {
        url: "https://www.shazam.com/en-us/event/c59ce4a1",
        title: "Bhuwin concert - New Delhi, The Piano Man New Delhi, Jul 09, 2026",
        content: "",
      },
    ]);
    const { candidates, note } = await d.discover(bhuwin);
    expect(r.calls).not.toContain(BMS);
    expect(r.calls).not.toContain("https://linktr.ee/bhuwin");
    expect(candidates).toEqual([]);
    expect(leads).toEqual([
      {
        artist: "Bhuwin",
        url: BMS,
        domain: "bookmyshow.com",
        title: "Sketchbook by Bhuwin Khursija music-shows Event Tickets Mumbai",
        reason: "denied_domain",
      },
    ]);
    expect(note.leads).toHaveLength(1);
  });

  it("reads an allow-listed outlet found by search as a trusted source", async () => {
    const { d } = discovery(
      {
        [SITE]: ok(SITE, "Bhuwin"),
        [RSI]: ok(RSI, "Bhuwin returns to Mumbai on 5 December 2026 with Sketchbook."),
      },
      [{ url: RSI, title: "Bhuwin's Sketchbook", content: "" }],
    );
    const { candidates } = await d.discover(bhuwin);
    expect(candidates).toEqual([
      expect.objectContaining({ source: "rollingstone", trust: "trusted", city: "Mumbai" }),
    ]);
  });

  it("respects the shared daily search cap", async () => {
    const { d, search } = discovery({ [SITE]: ok(SITE, "Bhuwin") }, [], 0);
    const { note } = await d.discover(bhuwin);
    expect(search.queries).toEqual([]);
    expect(note.skipped).toMatch(/daily search cap/u);
  });

  it("a failing page doesn't stop the artist", async () => {
    const { d } = discovery({ [SITE]: new Error("timeout") }, [
      { url: RSI, title: "x", content: "" },
    ]);
    const res = await d.discover(bhuwin);
    expect(res.note.pages[0]).toMatchObject({ url: SITE, error: "timeout" });
  });
});

describe("artistsForRun", () => {
  it("looks up named artists even when they aren't on the watchlist", () => {
    const picked = artistsForRun([], { perRun: 5, now, only: ["Bhuwin"] });
    expect(picked).toEqual([expect.objectContaining({ name: "Bhuwin", spotifyId: null })]);
  });
});

// ── publishDueCandidates (D-074) ────────────────────────────────────────────

function verificationStore(world: ReturnType<typeof fakeEventsWorld>) {
  const rows = new Map<
    string,
    { visibility: EventVisibility; verification: Verification | null }
  >();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { visibility: "held", verification: null });
    return rows.get(id)!;
  };
  const store: EventVerificationStore & {
    rows: typeof rows;
    visual: EventVisual | null;
    imageHolds: Set<string>;
  } = {
    rows,
    // D-091: a picture by default, so publishing tests keep their meaning; set to null to test holds.
    visual: { posterUrl: "https://example.org/poster.jpg", headliners: [] } as EventVisual | null,
    imageHolds: new Set<string>(),
    async visualOf() {
      return this.visual;
    },
    async setImageHold(id, held) {
      if (held) this.imageHolds.add(id);
      else this.imageHolds.delete(id);
    },
    async listImageHolds() {
      return [...this.imageHolds].map((id) => id as EventId);
    },
    async save(id, v) {
      row(id).verification = v;
    },
    async get(id) {
      const e = world.events.events.find((x) => x.id === id);
      return e
        ? {
            title: e.title,
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            lastVerifiedAt: null,
            ...row(id),
          }
        : null;
    },
    async listMissingLineups() {
      return [];
    },
    async setVisibility(id, v) {
      row(id).visibility = v;
    },
    async archivePast() {
      return 0;
    },
    async pastLineups() {
      return [];
    },
  };
  return store;
}

const night = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

function officialNight(iso: string): ValidatedGig {
  const page = { url: TOUR, title: "", text: TOUR_TEXT.replace("05th, 06th & 09th", iso.slice(8)) };
  const [c] = extractArtistGigs(page, "Bhuwin", {
    now,
    source: "artist_site",
    trust: "official",
    officialKind: "artist",
    via: "artist_site",
  });
  return {
    ...c!,
    title: "Bhuwin Live in Mumbai",
    artists: ["Bhuwin"],
    supportActs: [],
    venueName: null,
  } as ValidatedGig;
}

function outletNight(iso: string, over: Partial<ValidatedGig> = {}): ValidatedGig {
  return {
    source: "gig_web",
    trust: "trusted",
    externalId: `search:${RSI}#${iso}`,
    url: RSI,
    title: "Bhuwin Live in Mumbai",
    type: "concert",
    startsAt: night(iso),
    endsAt: null,
    dateExplicit: true,
    city: "Mumbai",
    country: "IN",
    venueName: null,
    artists: ["Bhuwin"],
    supportActs: [],
    confidence: 0.8,
    ...over,
  };
}

function publishSetup(pool: ValidatedGig[], match: MatchStatus | null = "auto") {
  const world = fakeEventsWorld(now);
  const verification = verificationStore(world);
  const decisions = new Map<string, GateRecord>();
  const audit: AuditEntry[] = [];
  const alerts = { send: vi.fn(async () => {}) };
  const deps = {
    candidates: { listUpcoming: async () => pool },
    matches: {
      statusOf: async () =>
        match ? { spotifyId: "6vsLn0UxL3GhtYP7ghpF3t", matchStatus: match } : null,
    },
    verification,
    decisions: {
      save: async (r: GateRecord) => void decisions.set(r.nightKey, r),
      get: async (k: string) => decisions.get(k) ?? null,
    },
    audit: {
      append: async (e: AuditEntry) => void audit.push(e),
      dueForReverification: async () => [],
    },
    store: { markPublished: vi.fn(async () => {}) },
    ingest: (a: Parameters<typeof ingestEvents>[1], o: Parameters<typeof ingestEvents>[2]) =>
      ingestEvents({ ...world, clock, logger }, a, o),
    findEventId: (s: EventSource, id: string) => world.events.findIdBySourceRef(s, id),
    alerts,
    clock,
    logger,
  };
  return { world, verification, decisions, audit, alerts, deps };
}

describe("publishDueCandidates", () => {
  // Two independent sources per night; the official one grounds every field.
  const run = ["2026-12-05", "2026-12-06", "2026-12-09"];
  const pool = run.flatMap((d) => [officialNight(d), outletNight(d)]);

  it("judges each night of a run separately and records every verdict", async () => {
    const { deps, decisions, world } = publishSetup(pool);
    const out = await publishDueCandidates(deps, {
      blockedReason: "AUTO_PUBLISH_ENABLED is not true",
      record: true,
    });
    expect(out.map((o) => o.night)).toEqual(run);
    expect(decisions.size).toBe(3);
    // The switch is off: nothing is written as an event.
    expect(world.events.events).toHaveLength(0);
    expect(out.every((o) => o.action === "skipped" || o.decision !== "publish")).toBe(true);
  });

  it("holds when confidence is under 0.9 (no venue, no identity), with the reason recorded", async () => {
    const { deps, decisions } = publishSetup(pool);
    const [first] = await publishDueCandidates(deps, { blockedReason: null, record: true });
    expect(first?.decision).toBe("hold");
    expect(decisions.get(first!.nightKey)?.reasons.join(" ")).toMatch(/confidence/u);
  });

  it("publishes a passing night, audits it, and never merges the run's nights", async () => {
    const withVenue = (c: ValidatedGig): ValidatedGig => ({ ...c, venueName: "OML HQ" });
    const strong = run.flatMap((d) => [withVenue(officialNight(d)), withVenue(outletNight(d))]);
    const { deps, audit, verification, world } = publishSetup(strong);
    const out = await publishDueCandidates(deps, { blockedReason: null, record: true });
    const published = out.filter((o) => o.action === "published");
    // Every published night is stored under its own date (D-073 multi-night rule).
    for (const o of published) {
      const e = world.events.events.find((x) => x.id === o.eventId)!;
      expect(isoDate(e.startsAt)).toBe(o.night);
      expect(e.startsAt.toISOString()).toBe(`${o.night}T14:00:00.000Z`); // 19:30 IST
      expect(verification.rows.get(o.eventId!)?.visibility).toBe("published");
      expect(verification.rows.get(o.eventId!)?.verification).toMatchObject({
        reviewedBy: "auto-gate",
      });
    }
    expect(audit.filter((a) => a.action === "published")).toHaveLength(published.length);
    expect(published.map((o) => o.night)).toEqual(run);
    expect(new Set(published.map((o) => o.eventId)).size).toBe(3);
  });

  it("leaves a night for the Lead when the ingest stored it under another night (dedupe merge)", async () => {
    const withVenue = (c: ValidatedGig): ValidatedGig => ({ ...c, venueName: "OML HQ" });
    const strong = run.flatMap((d) => [withVenue(officialNight(d)), withVenue(outletNight(d))]);
    const { deps, verification } = publishSetup(strong);
    const [first] = await publishDueCandidates(deps, { blockedReason: null, record: true });
    // Every later night "resolves" to the first night's event, as a ±1-day merge would.
    const merged = { ...deps, findEventId: async () => first!.eventId };
    const again = await publishDueCandidates(merged, { blockedReason: null, record: true });
    const later = again.filter((o) => o.night !== run[0]);
    expect(
      later.every((o) => o.action === "skipped" && /stored under 2026-12-05/u.test(o.detail ?? "")),
    ).toBe(true);
    expect(
      [...verification.rows.values()].filter((r) => r.visibility === "published"),
    ).toHaveLength(3);
  });

  it("D-091: a passing night without a picture is held no_image, then retried", async () => {
    const withVenue = (c: ValidatedGig): ValidatedGig => ({ ...c, venueName: "OML HQ" });
    const strong = [withVenue(officialNight(run[0]!)), withVenue(outletNight(run[0]!))];
    const { deps, verification, audit, decisions } = publishSetup(strong);
    verification.visual = { posterUrl: null, headliners: [{ imageUrl: null, altImageUrl: null }] };
    const [night] = await publishDueCandidates(deps, { blockedReason: null, record: true });
    expect(night).toMatchObject({ action: "held_no_image", decision: "hold" });
    expect(night!.reasons).toEqual([
      "has_image: no_image: Add a poster or a headliner photo first",
    ]);
    expect(verification.rows.get(night!.eventId!)?.visibility).toBe("held");
    expect([...verification.imageHolds]).toEqual([night!.eventId]);
    expect(audit.filter((a) => a.action === "published")).toHaveLength(0);
    expect(decisions.get(night!.nightKey)?.decision).toBe("hold");

    verification.visual = {
      posterUrl: null,
      headliners: [{ imageUrl: "https://i.scdn.co/a.jpg", altImageUrl: null }],
    };
    const [again] = await publishDueCandidates(deps, { blockedReason: null, record: true });
    expect(again).toMatchObject({ action: "published" });
    expect([...verification.imageHolds]).toEqual([]);
  });

  it("holds an unmatched headliner even with perfect sources", async () => {
    const { deps } = publishSetup(pool, "needs_review");
    const out = await publishDueCandidates(deps, { blockedReason: null, record: false });
    expect(out.every((o) => o.decision === "hold")).toBe(true);
    expect(out[0]!.reasons.join(" ")).toMatch(/headliner_matched/u);
  });

  it("a dry run records nothing", async () => {
    const { deps, decisions } = publishSetup(pool);
    await publishDueCandidates(deps, { blockedReason: "dry run", record: false });
    expect(decisions.size).toBe(0);
  });
});

// ── reverifyAutoPublished (D-074) ───────────────────────────────────────────

describe("reverifyAutoPublished", () => {
  const official: GateSource = {
    url: TOUR,
    domain: "bhuwin.example.com",
    officialKind: "artist" as const,
    title: "Bhuwin Live in Mumbai",
    night: "2026-12-05",
    startTime: "19:30",
    dateOnly: false,
    dateRange: false,
    city: "Mumbai",
    artists: ["Bhuwin"],
    quotes: { date: "5 December 2026", time: "7:30 PM", city: "Mumbai", headliner: "Bhuwin" },
    cancelled: false,
  };
  /** The outlet gave no time, so a new official time can't conflict with it. */
  const outlet: GateSource = {
    ...official,
    url: RSI,
    domain: "rollingstoneindia.com",
    officialKind: null,
    startTime: null,
    quotes: {},
  };

  function setup(page: ReadResult | Error, sources: GateSource[] = [official, outlet]) {
    const eventId = "11111111-1111-4111-8111-111111111111" as EventId;
    const audit: AuditEntry[] = [];
    const visibility: Record<string, EventVisibility> = { [eventId]: "published" };
    const updateStartTime = vi.fn(async () => {});
    const alerts = { send: vi.fn(async () => {}) };
    const deps = {
      audit: {
        append: async (e: AuditEntry) => void audit.push(e),
        dueForReverification: async () => [
          {
            eventId,
            nightKey: "2026-12-05|mumbai|bhuwin",
            sources,
            lastCheckedAt: new Date(now.getTime() - 4 * 86_400_000),
            path: null,
          },
        ],
      },
      reader: reader({ [TOUR]: page }),
      verification: {
        get: async () => ({
          title: "Bhuwin Live in Mumbai",
          visibility: visibility[eventId]!,
          startsAt: night("2026-12-05"),
          endsAt: null,
          verification: { confidence: 0.95 } as Verification,
          lastVerifiedAt: now,
        }),
        setVisibility: async (_id: EventId, v: EventVisibility) => void (visibility[eventId] = v),
      } as unknown as EventVerificationStore,
      matches: { statusOf: async () => ({ spotifyId: "x", matchStatus: "auto" as const }) },
      updateStartTime,
      alerts,
      clock,
      logger,
    };
    return { deps, audit, visibility, eventId, updateStartTime, alerts };
  }

  it("audits an unchanged page as reverified", async () => {
    const s = setup(ok(TOUR, "Bhuwin\nMumbai | 5 December 2026 | 7:30 PM"));
    const [r] = await reverifyAutoPublished(s.deps);
    expect(r?.result).toBe("unchanged");
    expect(s.audit.map((a) => a.action)).toEqual(["reverified"]);
    expect(s.visibility[s.eventId]).toBe("published");
  });

  it("updates a changed start time when the gate still passes", async () => {
    const s = setup(ok(TOUR, "Bhuwin\nMumbai | 5 December 2026 | 8:00 PM"));
    const [r] = await reverifyAutoPublished(s.deps);
    expect(r?.result).toBe("updated");
    expect(s.updateStartTime).toHaveBeenCalledWith(
      s.eventId,
      expect.objectContaining({ startTime: "20:00" }),
      "20:00",
    );
    expect(s.audit[0]).toMatchObject({
      action: "updated",
      changes: { startTime: { from: "19:30", to: "20:00" } },
    });
  });

  it("holds a changed start time that now conflicts with another source (never majority wins)", async () => {
    const s = setup(ok(TOUR, "Bhuwin\nMumbai | 5 December 2026 | 8:00 PM"), [
      official,
      { ...outlet, startTime: "19:30" },
    ]);
    const [r] = await reverifyAutoPublished(s.deps);
    expect(r?.result).toBe("held");
    expect(r?.detail).toMatch(/time: 20:00 ≠ 19:30/u);
    expect(s.updateStartTime).not.toHaveBeenCalled();
  });

  it.each([
    ["the page is gone", { status: "gone", url: TOUR } as ReadResult, /gone/u],
    [
      "the show is cancelled",
      ok(TOUR, "Bhuwin\nMumbai | 5 December 2026 | 7:30 PM — cancelled"),
      /cancelled/u,
    ],
    [
      "the date moved",
      ok(TOUR, "Bhuwin\nMumbai | 12 December 2026 | 7:30 PM"),
      /no longer listed/u,
    ],
  ])("holds and alerts when %s", async (_why, page, reason) => {
    const s = setup(page);
    const [r] = await reverifyAutoPublished(s.deps);
    expect(r?.result).toBe("held");
    expect(r?.detail).toMatch(reason);
    expect(s.visibility[s.eventId]).toBe("held");
    expect(s.audit[0]?.action).toBe("held");
    expect(s.alerts.send).toHaveBeenCalledOnce();
  });

  it("changes nothing when the page can't be reached right now", async () => {
    const s = setup(new Error("timeout"));
    const [r] = await reverifyAutoPublished(s.deps);
    expect(r?.result).toBe("skipped");
    expect(s.audit).toEqual([]);
    expect(s.visibility[s.eventId]).toBe("published");
  });
});

describe("runListings", () => {
  it("validates acts on Spotify, keeps one candidate per night, and writes only when asked", async () => {
    const { FakeArtistCatalog, spotifyArtist } =
      await import("@/application/matching/testing/fakes");
    const { ArtistValidator } = await import("@/application/ingestion/validate-artists");
    const { createMemoryCandidateStore, createMemoryValidationCache } =
      await import("@/application/ingestion/ports");
    const world = fakeEventsWorld(now);
    const catalog = new FakeArtistCatalog({
      "Nikhil Chinapa": [spotifyArtist("0a1b2c3d4e5f6g7h8i9j0k", "Nikhil Chinapa", 0)],
    });
    const validator = new ArtistValidator({
      catalog,
      artists: world.artists,
      cache: createMemoryValidationCache(),
      clock,
    });
    const listing = officialNight("2026-12-05");
    const night = (name: string, id: string) => ({
      ...listing,
      source: "highape" as const,
      externalId: id,
      artists: [{ name, parts: [] }],
    });
    const source = {
      source: "highape" as const,
      async *collect() {
        yield night("Nikhil Chinapa", "a");
        yield night("Karaoke Somebody", "b");
        throw new Error("second city page failed");
      },
    };
    const store = createMemoryCandidateStore();
    const deps = { validator, store, clock, logger };
    const dry = await runListings(deps, [source], { write: false });
    expect(dry.candidates.map((c) => c.artists)).toEqual([["Nikhil Chinapa"]]);
    expect(dry.sources[0]).toMatchObject({ items: 2, error: "second city page failed" });
    expect(store.rows).toHaveLength(0);
    await runListings(deps, [source], { write: true });
    expect(store.rows).toHaveLength(1);
  });
});

describe("demand-weighted discovery (D-081)", () => {
  it("searches around the artist's demand cities and gives floor artists fewer pages", async () => {
    const { searchCities } = await import("./discover-artist-gigs");
    expect(searchCities(["Guwahati"])).toEqual(["Guwahati", "Mumbai", "Delhi"]);
    expect(searchCities([])).toEqual(["Mumbai", "Delhi", "Bengaluru"]);

    const search = searchReturning([]);
    const pages = ["https://a.example/1", "https://a.example/2", "https://a.example/3"];
    const r = reader(
      Object.fromEntries([
        [SITE, ok(SITE, "x", { tourLinks: pages })],
        ...pages.map((p) => [p, ok(p, "x")]),
      ]),
    );
    const d = new ArtistGigDiscovery({
      search,
      reader: r,
      officialSites: { sitesOf: async () => [SITE] },
      leads: null,
      budget: memoryBudget(),
      clock,
      logger,
      caps: { searchesPerDay: 30 },
    });
    const artist = {
      name: "Ghy One",
      key: "ghy one",
      spotifyId: "6vsLn0UxL3GhtYP7ghpF3t",
      origins: [],
      score: 0,
    };
    await d.discover(artist, { cities: ["Guwahati"] });
    expect(search.queries[0]).toContain("Guwahati Mumbai Delhi");
    r.calls.length = 0;
    await d.discover(artist, { pages: 2 });
    expect(r.calls).toHaveLength(2);
  });

  it("falls back to the plain rotation when demand can't be read", async () => {
    const { loadRunPlan } = await import("./run-discovery");
    const warn = vi.fn();
    const out = await loadRunPlan(
      {
        demand: {
          record: async () => {},
          since: async () => Promise.reject(new Error("no table")),
        },
        shows: { upcomingPublished: async () => [] },
        artistCities: { list: async () => [] },
        clock,
        logger: { warn },
      },
      10,
    );
    expect(out.plan).toEqual({ metros: [], floorSlots: 10 });
    expect(warn).toHaveBeenCalled();
  });

  it("builds a plan from demand, shows and artist cities", async () => {
    const { loadRunPlan, artistsForRun } = await import("./run-discovery");
    const { plan, artistCities } = await loadRunPlan(
      {
        demand: {
          record: async () => {},
          since: async () => [
            { day: "2026-11-21", city: "Guwahati", kind: "search" as const, count: 4 },
          ],
        },
        shows: { upcomingPublished: async () => [{ city: "Guwahati", count: 1 }] },
        artistCities: { list: async () => [{ name: "Peter Cat Recording Co.", city: "Guwahati" }] },
        clock,
        logger,
      },
      4,
    );
    expect(plan.metros[0]).toMatchObject({ metro: "guwahati", scarce: true, slots: 3 });
    const list = [
      {
        name: "Peter Cat Recording Co.",
        key: "peter cat recording co",
        spotifyId: null,
        origins: ["catalogue" as const],
        score: 2,
      },
      {
        name: "Someone Else",
        key: "someone else",
        spotifyId: null,
        origins: ["trending" as const],
        score: 1,
      },
    ];
    const picked = artistsForRun(list, { perRun: 4, now, plan, artistCities });
    expect(picked.map((a) => ("reason" in a ? a.reason : ""))).toEqual(["guwahati", "floor"]);
  });
});

/**
 * QA D-056: event visibility (held | published | archived). Only `published` reaches public
 * surfaces: list, detail, suggest (typed + zero-query), /api/search, artist/city counts,
 * playlist status/start, and engagement signals. Admin-only visibility changes, strict input,
 * and `verification` must not leak raw payloads or internal verification state.
 */
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawEvent, SourceAdapter } from "@/application/ports/event-source";
import type { Database } from "@/db/client";
import type { EventId } from "@/domain/shared/ids";
import { createEventsModule, type EventsModule } from "@/infrastructure/events-module";
import { createPlaylistsModule, type PlaylistsModule } from "@/infrastructure/playlists-module";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { testDb } from "../../setup/db";

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "user" | "anon",
  module: null as unknown,
  playlists: null as unknown,
  client: "qa-client-1",
}));

vi.mock("@/server/auth/guards", () => ({
  requireAdmin: vi.fn(async () => {
    if (state.role === "anon") throw new UnauthorizedError("Sign in.");
    if (state.role === "user") throw new ForbiddenError("Admins only.");
    return { id: "u1", spotifyUserId: "s1", displayName: null, market: "IN", role: "admin" };
  }),
  requireUser: vi.fn(async () => {
    if (state.role === "anon") throw new UnauthorizedError("Sign in.");
    return { id: "u1", spotifyUserId: "s1", displayName: null, market: "IN", role: state.role };
  }),
}));
vi.mock("@/server/events", () => ({
  events: () => state.module as EventsModule,
  clientKey: () => state.client,
}));
vi.mock("@/server/playlists", () => ({
  playlists: () => state.playlists as PlaylistsModule,
  clientKey: () => state.client,
  requireEmptyBody: async (req: Request) => {
    const t = (await req.text()).trim();
    if (t !== "" && t !== "{}") throw new ValidationError("Body must be empty.");
  },
}));

const publicList = await import("@/app/api/events/route");
const publicDetail = await import("@/app/api/events/[id]/route");
const suggestRoute = await import("@/app/api/events/suggest/route");
const searchRoute = await import("@/app/api/search/route");
const clickRoute = await import("@/app/api/search/click/route");
const viewRoute = await import("@/app/api/events/[id]/view/route");
const playlistRoute = await import("@/app/api/events/[id]/playlist/route");
const adminList = await import("@/app/api/admin/events/route");
const adminDetail = await import("@/app/api/admin/events/[id]/route");

const db: Database = testDb();
const NOW = new Date("2026-11-21T00:00:00Z");
const GHOST = "11111111-1111-4111-8111-111111111111";
const TABLES =
  "search_log, event_stats, shared_playlists, playlist_jobs, playlists, event_artists, event_sources, events, venue_aliases, venues, artist_aliases, artists, ingest_runs";
const logger = pino({ level: "silent" });

/** Any Spotify call on these fakes is a test failure: held events must never reach Spotify. */
const forbidden = (what: string) =>
  new Proxy(
    {},
    {
      get: (_t, prop) => () => {
        throw new Error(`QA: ${what}.${String(prop)} must not be called`);
      },
    },
  );

beforeEach(async () => {
  state.role = "admin";
  state.client = `qa-client-${Math.random()}`;
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  const mod = createEventsModule({ db, clock: { now: () => NOW }, logger });
  state.module = mod;
  state.playlists = createPlaylistsModule({
    db,
    clock: { now: () => NOW },
    logger,
    trackCatalog: forbidden("trackCatalog") as never,
    playlistWriter: forbidden("playlistWriter") as never,
    events: mod,
    users: { findById: async () => null } as never,
    tokens: { find: async () => null } as never,
  });
});

afterAll(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  await db.$close();
});

// ── helpers ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const j = async (r: Response) => (await r.json()) as Json;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const u = (path: string) => `http://localhost${path}`;
const send = (method: string, b?: unknown) =>
  b === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(b) };

const listEvents = (qs = "") => publicList.GET(new Request(u(`/api/events${qs}`)), undefined as never);
const getEvent = (id: string) => publicDetail.GET(new Request(u(`/api/events/${id}`)), ctx(id));
const suggest = (qs = "") => suggestRoute.GET(new Request(u(`/api/events/suggest${qs}`)), undefined as never);
const search = (qs: string) => searchRoute.GET(new Request(u(`/api/search${qs}`)), undefined as never);
const click = (b: unknown) => clickRoute.POST(new Request(u("/api/search/click"), send("POST", b)), undefined as never);
const view = (id: string) => viewRoute.POST(new Request(u(`/api/events/${id}/view`), send("POST")), ctx(id));
const playlistGet = (id: string) => playlistRoute.GET(new Request(u(`/api/events/${id}/playlist`)), ctx(id));
const playlistPost = (id: string) => playlistRoute.POST(new Request(u(`/api/events/${id}/playlist`), send("POST")), ctx(id));
const adminGet = (qs = "") => adminList.GET(new Request(u(`/api/admin/events${qs}`)), undefined as never);
const adminGetOne = (id: string) => adminDetail.GET(new Request(u(`/api/admin/events/${id}`)), ctx(id));
const adminPost = (b: unknown) => adminList.POST(new Request(u("/api/admin/events"), send("POST", b)), undefined as never);
const patch = (id: string, b: unknown) => adminDetail.PATCH(new Request(u(`/api/admin/events/${id}`), send("PATCH", b)), ctx(id));

const input = (over: Json = {}): Json => ({
  title: "Published Gala",
  type: "concert",
  startsAt: "2027-02-10T14:00:00Z",
  venue: { name: "NSCI Dome", city: "Mumbai", country: "IN" },
  lineup: [
    { name: "Shared Artist", tier: "headliner", billingRank: 1 },
    { name: "Public Opener", tier: "support", billingRank: 2 },
  ],
  ...over,
});

async function create(over: Json = {}): Promise<string> {
  const r = await adminPost(input(over));
  expect([200, 201]).toContain(r.status);
  return ((await j(r)).event as Json).id as string;
}

async function setVisibility(id: string, visibility: string) {
  state.role = "admin";
  const r = await patch(id, { visibility });
  expect(r.status).toBe(200);
}

/**
 * A published control event plus a held and an archived event with unique marker words,
 * a held-only artist and a held-only city. The hidden events get a huge trend score so a
 * missing visibility filter would surface them in trending sections.
 */
async function world() {
  const pub = await create({ visibility: "published" });
  const held = await create({
    title: "Zebracorn Secret Night",
    startsAt: "2027-03-10T14:00:00Z",
    venue: { name: "Hidden Hall", city: "Shillong", country: "IN" },
    lineup: [
      { name: "Shared Artist", tier: "headliner", billingRank: 1 },
      { name: "Quixotrel Heldonly", tier: "support", billingRank: 2 },
    ],
  });
  const archived = await create({
    title: "Wombatique Archive Night",
    startsAt: "2027-04-10T14:00:00Z",
    venue: { name: "Old Hall", city: "Mumbai", country: "IN" },
    lineup: [
      { name: "Shared Artist", tier: "headliner", billingRank: 1 },
      { name: "Vexillon Archonly", tier: "support", billingRank: 2 },
    ],
  });
  await setVisibility(archived, "archived");
  for (const id of [held, archived]) {
    await db.execute(
      sql`INSERT INTO event_stats (event_id, views, search_clicks, playlist_opens, trend_score) VALUES (${id}, 9999, 9999, 9999, 1e9)`,
    );
  }
  return { pub, held, archived };
}

const HIDDEN_WORDS = /Zebracorn|Wombatique|Quixotrel|Vexillon|Hidden Hall|Old Hall|Shillong/i;

/** The response minus `filters`, which only echoes what the caller sent. */
const served = (b: Json) => JSON.stringify({ ...b, filters: undefined });

async function statsRow(id: string) {
  const rows = (await db.execute(
    sql`SELECT views, search_clicks, playlist_opens, trend_score FROM event_stats WHERE event_id = ${id}`,
  )) as unknown as Json[];
  return rows[0] ?? null;
}

// ── defaults ────────────────────────────────────────────────────────────

describe("QA D-056 defaults", () => {
  it("an admin-created event without visibility is held and invisible to the public", async () => {
    const id = await create();
    const admin = (await j(await adminGetOne(id))).event as Json;
    expect(admin.visibility).toBe("held");
    expect((await getEvent(id)).status).toBe(404);
    expect((await j(await listEvents())).total).toBe(0);
  });

  it("an ingested event is held", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    const items = (await j(await adminGet())).events as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]!.visibility).toBe("held");
    expect((await j(await listEvents())).total).toBe(0);
  });

  it("POST with visibility published is public at once", async () => {
    const id = await create({ visibility: "published" });
    expect((await getEvent(id)).status).toBe(200);
  });

  it("re-posting the same published event without visibility does not re-hold it", async () => {
    const id = await create({ visibility: "published" });
    const r = await adminPost(input({ title: "PUBLISHED GALA 2027" }));
    expect(r.status).toBe(200);
    expect(((await j(r)).event as Json).id).toBe(id);
    expect((await getEvent(id)).status).toBe(200);
  });

  it("re-ingesting an unchanged feed does not un-publish an event", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    const id = ((await j(await adminGet())).events as Json[])[0]!.id as string;
    await setVisibility(id, "published");
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    expect((await getEvent(id)).status).toBe(200);
  });
});

// ── public surfaces ─────────────────────────────────────────────────────

describe("QA D-056 public list and detail", () => {
  it("list returns only published; filters can't reach hidden events", async () => {
    const { pub } = await world();
    for (const qs of ["", "?city=Shillong", "?q=Zebracorn", "?q=Wombatique", "?city=Mumbai", "?pageSize=100", "?from=2027-03-01"]) {
      const b = await j(await listEvents(qs));
      const ids = (b.events as Json[]).map((e) => e.id);
      expect(ids.every((id) => id === pub)).toBe(true);
      expect(b.total).toBe(ids.length);
      expect(JSON.stringify(b)).not.toMatch(HIDDEN_WORDS);
    }
  });

  it("an unknown visibility query param is rejected publicly (no admin filter leak)", async () => {
    await world();
    const r = await listEvents("?visibility=held");
    expect(r.status).toBe(400);
  });

  it("held and archived detail is 404, identical to a missing event", async () => {
    const { held, archived } = await world();
    const ghost = await getEvent(GHOST);
    const ghostBody = await j(ghost);
    for (const id of [held, archived]) {
      const r = await getEvent(id);
      expect(r.status).toBe(404);
      const b = await j(r);
      expect((b.error as Json).code).toBe((ghostBody.error as Json).code);
      expect(JSON.stringify(b)).not.toMatch(HIDDEN_WORDS);
    }
  });

  it("un-publishing hides an event again immediately", async () => {
    const id = await create({ visibility: "published" });
    await setVisibility(id, "held");
    expect((await getEvent(id)).status).toBe(404);
    expect((await j(await listEvents())).total).toBe(0);
  });

  it("public list/detail don't expose admin verification fields", async () => {
    const id = await create({ visibility: "published" });
    await db.execute(sql`UPDATE events SET confidence = 0.42, verification = ${JSON.stringify({ internal: "VERIF-MARKER" })}::jsonb WHERE id = ${id}`);
    for (const text of [await (await listEvents()).text(), await (await getEvent(id)).text()]) {
      expect(text).not.toContain("VERIF-MARKER");
      expect(text).not.toMatch(/"confidence"|"visibility"/);
    }
  });
});

describe("QA D-056 suggest and search", () => {
  // BUG: typed suggest returns didYouMean "Quixotrel Heldonly", a name only on a held event
  it("typed suggest never returns hidden events, artists or cities", async () => {
    await world();
    for (const q of ["Zebracorn", "Wombatique", "Quixotrel", "Vexillon", "Shillong", "Hidden Hall", "Night", "Secret"]) {
      const r = await suggest(`?q=${encodeURIComponent(q)}`);
      expect(r.status).toBe(200);
      expect(served(await j(r))).not.toMatch(HIDDEN_WORDS);
    }
  });

  it("didYouMean / fallback never point at a hidden title", async () => {
    await world();
    const b = await j(await suggest("?q=Zebracorm")); // one typo away from a held title
    expect(JSON.stringify(b)).not.toMatch(/zebracorn/i);
  });

  it("zero-query sections (incl. trending and Near you) contain only published events", async () => {
    const { pub, held, archived } = await world();
    for (const qs of ["", "?city=Mumbai", "?city=Shillong"]) {
      const r = await suggest(qs);
      expect(r.status).toBe(200);
      const b = await j(r);
      const text = JSON.stringify(b);
      expect(text).not.toContain(held);
      expect(text).not.toContain(archived);
      expect(text).not.toMatch(HIDDEN_WORDS);
      const items = ((b.sections as Json[]) ?? []).flatMap((s) => (s.items as Json[] | undefined) ?? []);
      for (const it of items) expect(it.id).toBe(pub);
    }
  });

  it("artist and city counts only count published events", async () => {
    await world();
    const a = await j(await suggest("?q=Shared%20Artist"));
    const shared = (a.artists as Json[]).find((x) => /shared artist/i.test(String(x.name)));
    expect(shared?.upcomingCount).toBe(1);
    const c = await j(await suggest("?q=Mumbai"));
    const mumbai = (c.cities as Json[]).find((x) => x.city === "Mumbai");
    expect(mumbai?.upcomingCount).toBe(1);
    const s = await j(await search("?q=Shared%20Artist"));
    const shared2 = (s.artists as Json[]).find((x) => /shared artist/i.test(String(x.name)));
    expect(shared2?.upcomingCount).toBe(1);
  });

  it("/api/search returns only published, for text and explicit filters", async () => {
    const { pub } = await world();
    for (const qs of ["?q=Zebracorn", "?q=Wombatique", "?city=Shillong", "?artist=Quixotrel%20Heldonly", "?artist=Shared%20Artist", "?q=Night", "?city=Mumbai"]) {
      const r = await search(qs);
      expect(r.status).toBe(200);
      const b = await j(r);
      expect(served(b)).not.toMatch(HIDDEN_WORDS);
      for (const res of b.results as Json[]) expect(res.id).toBe(pub);
      expect(b.total).toBe((b.results as Json[]).length);
    }
  });
});

// ── engagement ──────────────────────────────────────────────────────────

describe("QA D-056 views and clicks on hidden events count nothing", () => {
  // BUG: view on a held/archived event returns 204 (missing event: 404), revealing hidden IDs; stats are not bumped
  it("view: published control counts; held/archived are 404 like a missing event and count nothing", async () => {
    const { pub, held, archived } = await world();
    expect((await view(pub)).status).toBe(204);
    expect(Number((await statsRow(pub))?.views)).toBe(1);
    const ghost = (await view(GHOST)).status;
    expect(ghost).toBe(404);
    for (const id of [held, archived]) {
      const before = await statsRow(id);
      const status = (await view(id)).status;
      expect(await statsRow(id)).toEqual(before);
      expect(status).toBe(ghost);
    }
  });

  // BUG: search click on a held/archived event returns 204 instead of 404 (existence oracle)
  it("search click: held/archived are 404 and nothing is logged or counted", async () => {
    const { pub, held, archived } = await world();
    expect((await click({ q: "gala", eventId: pub })).status).toBe(204);
    for (const id of [held, archived]) {
      const before = await statsRow(id);
      const status = (await click({ q: "zebracorn", eventId: id })).status;
      expect(await statsRow(id)).toEqual(before);
      const logged = (await db.execute(sql`SELECT count(*)::int AS n FROM search_log WHERE clicked_event_id = ${id}`)) as unknown as Json[];
      expect(Number(logged[0]!.n)).toBe(0);
      expect(status).toBe(404);
    }
  });

  it("playlist-open signal on a hidden event counts nothing", async () => {
    const { held } = await world();
    const mod = state.module as EventsModule;
    const before = await statsRow(held);
    await mod.recordPlaylistOpen(held as EventId, "qa").catch(() => undefined);
    expect(await statsRow(held)).toEqual(before);
  });
});

// ── playlists ───────────────────────────────────────────────────────────

describe("QA D-056 playlist status and start", () => {
  it("held/archived: playlist start is 404 like a missing event, creates no job, calls no Spotify", async () => {
    const { held, archived } = await world();
    const ghost = (await playlistPost(GHOST)).status;
    expect(ghost).toBe(404);
    for (const id of [held, archived]) {
      expect((await playlistPost(id)).status).toBe(404);
      const jobs = (await db.execute(sql`SELECT count(*)::int AS n FROM playlist_jobs WHERE event_id = ${id}`)) as unknown as Json[];
      expect(Number(jobs[0]!.n)).toBe(0);
    }
  });

  it("an existing shared playlist is not served once its event is held", async () => {
    const id = await create({ visibility: "published" });
    await db.execute(
      sql`INSERT INTO shared_playlists (event_id, spotify_playlist_id, url, track_ids, lineup_hash_at_build) SELECT id, 'sp-held-1', 'https://open.spotify.com/playlist/sp-held-1', ARRAY['t1'], lineup_hash FROM events WHERE id = ${id}`,
    );
    const before = await playlistGet(id);
    expect(before.status).toBe(200);
    expect((await j(before)).status).toBe("ready");
    await setVisibility(id, "held");
    const after = await playlistGet(id);
    expect(after.status).toBe(404);
    expect(await after.text()).not.toContain("sp-held-1");
    expect((await playlistPost(id)).status).toBe(404);
  });

});

// ── PATCH visibility ────────────────────────────────────────────────────

describe("QA D-056 PATCH visibility", () => {
  it.each([
    ["anon", 401],
    ["user", 403],
  ] as const)("%s can't change visibility (%i) and nothing changes", async (role, status) => {
    const id = await create();
    state.role = role;
    expect((await patch(id, { visibility: "published" })).status).toBe(status);
    state.role = "admin";
    expect((await getEvent(id)).status).toBe(404);
    expect(((await j(await adminGetOne(id))).event as Json).visibility).toBe("held");
  });

  it("non-admins can't read admin lists to discover held events", async () => {
    await world();
    state.role = "user";
    expect((await adminGet("?visibility=held")).status).toBe(403);
    state.role = "anon";
    expect((await adminGet("?visibility=held")).status).toBe(401);
  });

  it.each([
    ["unknown value", { visibility: "public" }],
    ["wrong case", { visibility: "PUBLISHED" }],
    ["null", { visibility: null }],
    ["number", { visibility: 1 }],
    ["array", { visibility: ["published"] }],
    ["extra key", { visibility: "published", confidence: 1 }],
    ["forged verification", { visibility: "published", lastVerifiedAt: "2026-11-21T00:00:00Z" }],
  ])("400 for %s, event stays held", async (_n, b) => {
    const id = await create();
    const r = await patch(id, b);
    expect(r.status).toBe(400);
    expect(((await j(r)).error as Json).code).toBe("validation_failed");
    expect((await getEvent(id)).status).toBe(404);
  });

  it("POST rejects an invalid visibility", async () => {
    const r = await adminPost(input({ visibility: "live" }));
    expect(r.status).toBe(400);
    expect((await j(await adminGet())).total).toBe(0);
  });

  it("unknown / malformed id → 404", async () => {
    expect((await patch(GHOST, { visibility: "published" })).status).toBe(404);
    expect((await patch("nope", { visibility: "published" })).status).toBe(404);
  });

  // BUG: PATCH {visibility} adds an "admin" event_sources row, so it changes more than visibility
  it("changes only visibility: fields, lineup hash and sources are untouched", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    const id = ((await j(await adminGet())).events as Json[])[0]!.id as string;
    const snap = async () =>
      ((await db.execute(sql`SELECT title, type, status, starts_at, ends_at, genre, image_url, venue_id, lineup_hash, dedupe_key FROM events WHERE id = ${id}`)) as unknown as Json[])[0];
    const sources = async () =>
      (await db.execute(sql`SELECT source, external_id FROM event_sources WHERE event_id = ${id} ORDER BY source`)) as unknown as Json[];
    const lineup = async () =>
      (await db.execute(sql`SELECT artist_id, billing_rank, tier FROM event_artists WHERE event_id = ${id} ORDER BY billing_rank`)) as unknown as Json[];
    const [b1, s1, l1] = [await snap(), await sources(), await lineup()];
    await setVisibility(id, "published");
    expect(await snap()).toEqual(b1);
    expect(await sources()).toEqual(s1);
    expect(await lineup()).toEqual(l1);
  });

  // BUG: after a visibility-only PATCH the event counts as admin-sourced and Ticketmaster updates are blocked
  it("publishing a feed event doesn't make it admin-owned: the feed can still update it (D-026 scope)", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    const id = ((await j(await adminGet())).events as Json[])[0]!.id as string;
    await setVisibility(id, "published");
    await mod.ingest(feed([tmEvent("tm-1", { genre: "Jazz" })]), { from: NOW });
    const ev = (await j(await getEvent(id))).event as Json;
    expect(ev.genre).toBe("Jazz");
  });

  it("admin list and detail expose visibility, confidence and lastVerifiedAt; list filters by visibility", async () => {
    const { pub, held, archived } = await world();
    const all = (await j(await adminGet())).events as Json[];
    expect(all).toHaveLength(3);
    for (const e of all) {
      expect(e).toHaveProperty("visibility");
      expect(e).toHaveProperty("confidence");
      expect(e).toHaveProperty("lastVerifiedAt");
    }
    const ids = async (v: string) => ((await j(await adminGet(`?visibility=${v}`))).events as Json[]).map((e) => e.id);
    expect(await ids("held")).toEqual([held]);
    expect(await ids("archived")).toEqual([archived]);
    expect(await ids("published")).toEqual([pub]);
    expect((await adminGet("?visibility=bogus")).status).toBe(400);
    const d = (await j(await adminGetOne(held))).event as Json;
    expect(d).toMatchObject({ visibility: "held" });
    expect(d).toHaveProperty("confidence");
    expect(d).toHaveProperty("lastVerifiedAt");
  });
});

// ── verification block ──────────────────────────────────────────────────

describe("QA D-056 published verification block", () => {
  it("has exactly {sourcesCount, lastVerifiedAt, sources:[{source,url}]} and no raw payload", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(feed([tmEvent("tm-1")]), { from: NOW });
    const id = ((await j(await adminGet())).events as Json[])[0]!.id as string;
    await db.execute(sql`UPDATE events SET verification = ${JSON.stringify({ evidence: "VERIF-INTERNAL" })}::jsonb WHERE id = ${id}`);
    await setVisibility(id, "published");
    const r = await getEvent(id);
    const text = await r.text();
    expect(text).not.toContain("RAW-MARKER");
    expect(text).not.toContain("VERIF-INTERNAL");
    expect(text).not.toContain("tm-1-ext");
    const v = ((JSON.parse(text) as Json).event as Json).verification as Json;
    expect(Object.keys(v).sort()).toEqual(["lastVerifiedAt", "sources", "sourcesCount"]);
    expect(v.sourcesCount).toBe(1);
    for (const s of v.sources as Json[]) expect(Object.keys(s).sort()).toEqual(["source", "url"]);
    expect((v.sources as Json[]).map((s) => s.source)).toContain("ticketmaster");
  });

  it("admin entry isn't counted as an independent source", async () => {
    const id = await create({ visibility: "published" });
    const v = ((await j(await getEvent(id))).event as Json).verification as Json;
    expect(v.sourcesCount).toBe(0);
  });
});

// ── feed fixtures ───────────────────────────────────────────────────────

function tmEvent(externalId: string, over: Partial<RawEvent> = {}): RawEvent {
  return {
    source: "ticketmaster",
    externalId: `${externalId}-ext`,
    url: `https://tm.example/${externalId}`,
    title: "Feed Concert",
    type: "concert",
    startsAt: new Date("2027-05-01T14:00:00Z"),
    venue: { name: "Jio World Garden", city: "Mumbai", country: "IN" },
    lineup: [{ name: "Feed Artist", tier: "headliner", billingRank: 1 }],
    genre: "Rock",
    raw: { secret: "RAW-MARKER" },
    ...over,
  };
}

function feed(events: RawEvent[]): SourceAdapter {
  return {
    source: "ticketmaster",
    async *fetch() {
      for (const e of events) yield e;
    },
  };
}

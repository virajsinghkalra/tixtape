/**
 * QA P1.7: public event routes and admin event routes (LLD §9, D-012, D-018, D-026).
 * Real Postgres; `requireAdmin` is mocked for admin / non-admin / signed-out.
 */
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { createEventsModule, type EventsModule } from "@/infrastructure/events-module";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { testDb } from "../../setup/db";

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "user" | "anon",
  module: null as unknown,
}));

vi.mock("@/server/auth/guards", () => {
  const admin = async () => {
    if (state.role === "anon") throw new UnauthorizedError("Sign in.");
    if (state.role === "user") throw new ForbiddenError("Admins only.");
    return { id: "u1", spotifyUserId: "s1", displayName: null, market: "IN", role: "admin" };
  };
  return {
    requireAdmin: vi.fn(admin),
    requireUser: vi.fn(async () => {
      if (state.role === "anon") throw new UnauthorizedError("Sign in.");
      return { id: "u1", spotifyUserId: "s1", displayName: null, market: "IN", role: state.role };
    }),
  };
});
vi.mock("@/server/events", () => ({ events: () => state.module as EventsModule }));

const publicList = await import("@/app/api/events/route");
const publicDetail = await import("@/app/api/events/[id]/route");
const adminList = await import("@/app/api/admin/events/route");
const adminDetail = await import("@/app/api/admin/events/[id]/route");

const db: Database = testDb();
const NOW = new Date("2026-11-21T00:00:00Z");
const TABLES =
  "event_artists, event_sources, events, venue_aliases, venues, artist_aliases, artists, ingest_runs";
const GHOST = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  state.role = "admin";
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  state.module = createEventsModule({
    db,
    clock: { now: () => NOW },
    logger: pino({ level: "silent" }),
  });
});

afterAll(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  await db.$close();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const listEvents = (qs = "") =>
  publicList.GET(new Request(`http://localhost/api/events${qs}`), undefined as never);
const getEvent = (id: string) =>
  publicDetail.GET(new Request(`http://localhost/api/events/${id}`), ctx(id));
const adminGet = (qs = "") =>
  adminList.GET(new Request(`http://localhost/api/admin/events${qs}`), undefined as never);
const adminGetOne = (id: string) =>
  adminDetail.GET(new Request(`http://localhost/api/admin/events/${id}`), ctx(id));
const body = (method: string, b: unknown, raw: boolean) => ({
  method,
  headers: { "content-type": "application/json" },
  body: raw ? (b as string) : JSON.stringify(b),
});
const post = (b: unknown, raw = false) =>
  adminList.POST(
    new Request("http://localhost/api/admin/events", body("POST", b, raw)),
    undefined as never,
  );
const patch = (id: string, b: unknown, raw = false) =>
  adminDetail.PATCH(
    new Request(`http://localhost/api/admin/events/${id}`, body("PATCH", b, raw)),
    ctx(id),
  );

type Json = Record<string, unknown>;
const j = async (r: Response) => (await r.json()) as Json;

const lineup = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Artist ${i + 1}`,
    tier: i === 0 ? "headliner" : "support",
    billingRank: i + 1,
  }));

const valid = (over: Json = {}): Json => ({
  title: "Lollapalooza India",
  // D-056: new events are held; public-read fixtures publish explicitly.
  visibility: "published",
  type: "festival",
  startsAt: "2027-01-25T10:30:00Z",
  endsAt: "2027-01-26T18:30:00Z",
  venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
  lineup: [
    { name: "Headliner One", tier: "headliner", billingRank: 1 },
    { name: "Nucleya b2b Ritviz", tier: "sub", billingRank: 2 },
  ],
  ...over,
});

async function seed(over: Json = {}) {
  const r = await post(valid(over));
  expect(r.status).toBe(201);
  const b = await j(r);
  return (b.event as Json).id as string;
}

async function expect400(p: Promise<Response>) {
  const r = await p;
  expect(r.status).toBe(400);
  expect(((await j(r)).error as Json).code).toBe("validation_failed");
}

describe("QA GET /api/events", () => {
  it("lists with the documented envelope, ordered by start", async () => {
    await seed({ title: "Later", startsAt: "2027-03-01T10:00:00Z", endsAt: null });
    await seed({
      title: "Sooner",
      startsAt: "2027-02-01T10:00:00Z",
      endsAt: null,
      venue: { name: "NSCI Dome", city: "Mumbai", country: "IN" },
    });
    const r = await listEvents();
    expect(r.status).toBe(200);
    const b = await j(r);
    expect(Object.keys(b).sort()).toEqual(["events", "page", "pageSize", "total"]);
    expect(b.total).toBe(2);
    expect((b.events as Json[]).map((e) => e.title)).toEqual(["Sooner", "Later"]);
  });

  it("city filter accepts aliases (Bombay finds Mumbai)", async () => {
    await seed();
    const b = await j(await listEvents("?city=Bombay"));
    expect(b.total).toBe(1);
    expect((await j(await listEvents("?city=Pune"))).total).toBe(0);
  });

  it("from/to and type filters", async () => {
    await seed();
    expect((await j(await listEvents("?from=2027-01-26&to=2027-02-01"))).total).toBe(0);
    expect((await j(await listEvents("?from=2027-01-25&to=2027-01-25T23:59:59Z"))).total).toBe(1);
    expect((await j(await listEvents("?type=concert"))).total).toBe(0);
    expect((await j(await listEvents("?type=festival"))).total).toBe(1);
  });

  it.each([
    ["unknown key", "?foo=1"],
    ["bad from date", "?from=yesterday"],
    ["impossible date", "?from=2027-02-30"],
    ["from > to", "?from=2027-02-01&to=2027-01-01"],
    ["pageSize 0", "?pageSize=0"],
    ["pageSize 101", "?pageSize=101"],
    ["pageSize negative", "?pageSize=-5"],
    ["pageSize non-numeric", "?pageSize=abc"],
    ["pageSize fractional", "?pageSize=1.5"],
    ["page 0", "?page=0"],
    ["bad type", "?type=opera"],
  ])("400 for %s", async (_n, qs) => {
    await expect400(listEvents(qs));
  });

  it("pageSize 100 is allowed", async () => {
    expect((await listEvents("?pageSize=100")).status).toBe(200);
  });

  it("repeated parameters don't cause a 500", async () => {
    const r = await listEvents("?city=Mumbai&city=Pune");
    expect([200, 400]).toContain(r.status);
  });

  it("SQL-ish q is inert and the table survives", async () => {
    await seed();
    const r = await listEvents(`?q=${encodeURIComponent("'; DROP TABLE events; --")}`);
    expect(r.status).toBe(200);
    expect((await j(r)).total).toBe(0);
    expect((await j(await listEvents())).total).toBe(1);
  });

  it("q treats LIKE wildcards literally", async () => {
    await seed();
    expect((await j(await listEvents("?q=%25"))).total).toBe(0);
    expect((await j(await listEvents("?q=_"))).total).toBe(0);
    expect((await j(await listEvents("?q=PALOOZA"))).total).toBe(1);
  });

  it("huge q is rejected or handled, never a 500", async () => {
    const r = await listEvents(`?q=${"a".repeat(20_000)}`);
    expect([200, 400]).toContain(r.status);
  });

  it("pages beyond the end return an empty list with the real total", async () => {
    await seed();
    const b = await j(await listEvents("?page=50&pageSize=10"));
    expect(b.events).toEqual([]);
    expect(b.total).toBe(1);
  });
});

describe("QA GET /api/events/:id", () => {
  it("invalid UUID → 404, unknown UUID → 404", async () => {
    for (const id of ["not-a-uuid", "1", "' OR 1=1 --", GHOST]) {
      const r = await getEvent(id);
      expect(r.status).toBe(404);
    }
  });

  it("returns lineup with tier and match status, and no sources/raw", async () => {
    const id = await seed();
    const r = await getEvent(id);
    expect(r.status).toBe(200);
    const b = await j(r);
    const ev = b.event as Json;
    const lu = ev.lineup as Json[];
    expect(lu.map((l) => l.name)).toEqual(["Headliner One", "Nucleya", "Ritviz"]);
    for (const l of lu) {
      expect(l).toHaveProperty("tier");
      expect(l).toHaveProperty("matchStatus");
    }
    expect(ev).not.toHaveProperty("sources");
    expect(JSON.stringify(b)).not.toMatch(/"raw"|externalId|"source"/);
  });

  it("an ingested event's raw payload never leaks through the public route", async () => {
    const mod = state.module as EventsModule;
    await mod.ingest(
      {
        source: "ticketmaster",
        async *fetch() {
          yield {
            source: "ticketmaster" as const,
            externalId: "tm-1",
            title: "TM Show",
            type: "concert" as const,
            startsAt: new Date("2027-01-25T10:30:00Z"),
            venue: { name: "NSCI Dome", city: "Mumbai", country: "IN" },
            lineup: [{ name: "X", tier: "headliner" as const, billingRank: 1 }],
            raw: { secret: "RAW-MARKER-XYZ" },
          };
        },
      },
      { from: NOW },
    );
    const ingested = ((await j(await adminGet())).events as Json[])[0]!.id as string;
    expect((await patch(ingested, { visibility: "published" })).status).toBe(200);
    const list = await listEvents();
    const text = await list.text();
    expect(text).not.toContain("RAW-MARKER-XYZ");
    const id = ((JSON.parse(text) as Json).events as Json[])[0]!.id as string;
    expect(await (await getEvent(id)).text()).not.toContain("RAW-MARKER-XYZ");
  });
});

describe("QA admin auth", () => {
  it.each([
    ["anon", 401],
    ["user", 403],
  ] as const)("%s gets %i on every admin route and nothing is written", async (role, status) => {
    const id = await seed();
    state.role = role;
    expect((await adminGet()).status).toBe(status);
    expect((await adminGetOne(id)).status).toBe(status);
    expect((await post(valid({ title: "Sneaky" }))).status).toBe(status);
    expect((await patch(id, { title: "Hijacked" })).status).toBe(status);
    state.role = "admin";
    const b = await j(await adminGetOne(id));
    expect((b.event as Json).title).toBe("Lollapalooza India");
    expect((await j(await listEvents())).total).toBe(1);
  });
});

describe("QA POST /api/admin/events", () => {
  it("201 created, then 200 merged for the same event", async () => {
    const r1 = await post(valid());
    expect(r1.status).toBe(201);
    expect((await j(r1)).outcome).toBe("created");
    const r2 = await post(
      valid({
        title: "LOLLAPALOOZA India 2027",
        venue: { name: "Mahalakshmi Race Course", city: "Bombay", country: "IN" },
      }),
    );
    expect(r2.status).toBe(200);
    expect((await j(r2)).outcome).toBe("merged");
    expect((await j(await listEvents())).total).toBe(1);
  });

  it("accepts exactly 300 artists", async () => {
    expect((await post(valid({ lineup: lineup(300) }))).status).toBe(201);
  });

  it.each([
    ["0 artists", { lineup: [] }],
    ["301 artists", { lineup: lineup(301) }],
    [
      "duplicate ranks",
      {
        lineup: [
          { name: "A", tier: "headliner", billingRank: 1 },
          { name: "B", tier: "sub", billingRank: 1 },
        ],
      },
    ],
    ["bad tier", { lineup: [{ name: "A", tier: "opener", billingRank: 1 }] }],
    ["rank 0", { lineup: [{ name: "A", tier: "headliner", billingRank: 0 }] }],
    ["blank artist", { lineup: [{ name: "   ", tier: "headliner", billingRank: 1 }] }],
    ["end before start", { startsAt: "2027-01-25T10:30:00Z", endsAt: "2027-01-25T09:00:00Z" }],
    ["bad startsAt", { startsAt: "25/01/2027" }],
    ["missing title", { title: undefined }],
    ["unknown top-level key", { hacker: true }],
    ["unknown venue key", { venue: { name: "V", city: "Mumbai", country: "IN", id: GHOST } }],
    [
      "unknown lineup key",
      { lineup: [{ name: "A", tier: "headliner", billingRank: 1, artistId: GHOST }] },
    ],
    ["bad country", { venue: { name: "V", city: "Mumbai", country: "India" } }],
    ["bad type", { type: "gig" }],
    // Regression QA-E-2 (fixed): javascript: imageUrl
    ["javascript: imageUrl", { imageUrl: "javascript:alert(1)" }],
    // Regression QA-E-2 (fixed): javascript: event link
    ["javascript: url", { url: "javascript:alert(document.cookie)" }],
  ])("400 for %s", async (_n, over) => {
    await expect400(post(valid(over as Json)));
    expect((await j(await listEvents())).total).toBe(0);
  });

  it("400 for malformed JSON and non-object bodies", async () => {
    await expect400(post("{not json", true));
    await expect400(post("[]", true));
    await expect400(post("null", true));
  });
});

describe("QA PATCH /api/admin/events/:id", () => {
  it("partial update keeps other fields", async () => {
    const id = await seed({ genre: "EDM" });
    const r = await patch(id, { title: "New Title" });
    expect(r.status).toBe(200);
    const ev = (await j(await getEvent(id))).event as Json;
    expect(ev.title).toBe("New Title");
    expect(ev.genre).toBe("EDM");
    expect((ev.lineup as Json[]).length).toBe(3);
  });

  it("lineup replaces the whole lineup", async () => {
    const id = await seed();
    const r = await patch(id, {
      lineup: [{ name: "Only One", tier: "headliner", billingRank: 1 }],
    });
    expect(r.status).toBe(200);
    const ev = (await j(await getEvent(id))).event as Json;
    expect((ev.lineup as Json[]).map((l) => l.name)).toEqual(["Only One"]);
  });

  it("invalid / unknown id → 404", async () => {
    expect((await patch("not-a-uuid", { title: "x" })).status).toBe(404);
    expect((await patch(GHOST, { title: "x" })).status).toBe(404);
    expect((await adminGetOne("not-a-uuid")).status).toBe(404);
    expect((await adminGetOne(GHOST)).status).toBe(404);
  });

  it.each([
    ["unknown key", { title: "x", lineupHash: "forged" }],
    ["bad tier in lineup", { lineup: [{ name: "A", tier: "opener", billingRank: 1 }] }],
    ["301 artists", { lineup: lineup(301) }],
    ["blank title", { title: "  " }],
  ])("400 for %s", async (_n, b) => {
    const id = await seed();
    await expect400(patch(id, b));
  });

  it("endsAt before the stored startsAt → 400", async () => {
    const id = await seed({ endsAt: null });
    await expect400(patch(id, { endsAt: "2027-01-24T00:00:00Z" }));
  });

  it("moving an event onto another event's dedupe key → 409", async () => {
    await seed({ title: "Alpha Night", endsAt: null });
    const b = await seed({ title: "Beta Night", startsAt: "2027-02-25T10:30:00Z", endsAt: null });
    const r = await patch(b, { title: "Alpha Night", startsAt: "2027-01-25T10:30:00Z" });
    expect(r.status).toBe(409);
  });

  it("admin detail lists contributing sources", async () => {
    const id = await seed();
    const ev = (await j(await adminGetOne(id))).event as Json;
    expect((ev.sources as Json[]).map((s) => s.source)).toContain("admin");
  });
});

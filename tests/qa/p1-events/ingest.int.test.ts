/**
 * QA P1.6 ingest pipeline against real Postgres: idempotency, lineup hash, ingest_runs,
 * admin precedence (D-026), cross-source dedupe (LLD §5.3).
 */
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { RawEvent, SourceAdapter } from "@/application/ports/event-source";
import type { Database } from "@/db/client";
import type { EventId } from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";
import { createEventsModule, type EventsModule } from "@/infrastructure/events-module";
import { UpstreamError } from "@/lib/errors";
import { testDb } from "../../setup/db";

const db: Database = testDb();
const NOW = new Date("2026-11-21T00:00:00Z");
const logger = pino({ level: "silent" });

const TABLES = [
  "event_artists",
  "event_sources",
  "events",
  "venue_aliases",
  "venues",
  "artist_aliases",
  "artists",
  "ingest_runs",
];

async function truncate() {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
}

async function count(table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return Number((rows as unknown as { n: number }[])[0]!.n);
}

async function snapshot() {
  const out: Record<string, number> = {};
  for (const t of TABLES.filter((t) => t !== "ingest_runs")) out[t] = await count(t);
  return out;
}

function feed(events: RawEvent[], source: EventSource = "ticketmaster"): SourceAdapter {
  return {
    source,
    async *fetch() {
      for (const e of events) yield e;
    },
  };
}

function failingFeed(before: RawEvent[]): SourceAdapter {
  return {
    source: "ticketmaster",
    async *fetch() {
      for (const e of before) yield e;
      throw new UpstreamError("ticketmaster", "HTTP 503");
    },
  };
}

const ev = (over: Partial<RawEvent> & { externalId: string }): RawEvent => ({
  source: "ticketmaster",
  title: "Lollapalooza India",
  type: "festival",
  startsAt: new Date("2027-01-25T10:30:00Z"),
  endsAt: null,
  url: `https://tm.example/${over.externalId}`,
  imageUrl: null,
  genre: "Rock",
  venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
  lineup: [
    { name: "Headliner One", tier: "headliner", billingRank: 1 },
    { name: "Nucleya b2b Ritviz", tier: "sub", billingRank: 2 },
    { name: "Opener", tier: "support", billingRank: 3 },
  ],
  raw: { tm: over.externalId, secret: "RAW-MARKER" },
  ...over,
});

const FEED: RawEvent[] = [
  ev({ externalId: "tm-lolla" }),
  ev({
    externalId: "tm-ap",
    title: "AP Dhillon Live",
    type: "concert",
    startsAt: new Date("2027-02-10T14:00:00Z"),
    venue: { name: "Phoenix Marketcity", city: "Bangalore", country: "IN" },
    lineup: [
      { name: "AP Dhillon", tier: "headliner", billingRank: 1 },
      { name: "Opener", tier: "support", billingRank: 2 },
    ],
  }),
  ev({
    externalId: "tm-ritviz",
    title: "Ritviz Solo",
    type: "concert",
    startsAt: new Date("2027-03-01T14:00:00Z"),
    venue: { name: "Phoenix Marketcity, Bengaluru", city: "Bengaluru", country: "IN" },
    lineup: [{ name: "Ritviz", tier: "headliner", billingRank: 1 }],
  }),
];

let mod: EventsModule;
const opts = { from: NOW };

beforeEach(async () => {
  await truncate();
  mod = createEventsModule({ db, clock: { now: () => NOW }, logger });
});

afterAll(async () => {
  await truncate();
  await db.$close();
});

async function eventIdFor(externalId: string): Promise<EventId> {
  const rows = (await db.execute(
    sql`SELECT event_id FROM event_sources WHERE source = 'ticketmaster' AND external_id = ${externalId}`,
  )) as unknown as { event_id: string }[];
  return rows[0]!.event_id as EventId;
}

async function eventRow(id: string) {
  const rows = (await db.execute(sql`SELECT * FROM events WHERE id = ${id}`)) as unknown as Record<
    string,
    unknown
  >[];
  return rows[0]!;
}

describe("QA ingest: idempotency", () => {
  it("re-ingesting the same feed creates nothing new", async () => {
    const first = await mod.ingest(feed(FEED), opts);
    expect(first.status).toBe("succeeded");
    expect(first.itemsSeen).toBe(3);
    expect(first.itemsNew).toBe(3);
    const after1 = await snapshot();
    expect(after1).toMatchObject({ events: 3, event_sources: 3, venues: 2 });
    // Headliner One, Nucleya, Ritviz, Opener, AP Dhillon
    expect(after1.artists).toBe(5);
    expect(after1.event_artists).toBe(4 + 2 + 1);

    const second = await mod.ingest(feed(FEED), opts);
    expect(second.itemsSeen).toBe(3);
    expect(second.itemsNew).toBe(0);
    expect(await snapshot()).toEqual(after1);
  });

  it("concurrent ingests of the same feed don't duplicate rows", async () => {
    await Promise.allSettled([mod.ingest(feed(FEED), opts), mod.ingest(feed(FEED), opts)]);
    const s = await snapshot();
    expect(s).toMatchObject({
      events: 3,
      event_sources: 3,
      venues: 2,
      artists: 5,
      event_artists: 7,
    });
  });
});

describe("QA ingest: lineup changes", () => {
  it("a changed lineup updates lineup_hash and event_artists", async () => {
    await mod.ingest(feed(FEED), opts);
    const id = await eventIdFor("tm-ap");
    const before = await eventRow(id);
    const changed = FEED.map((e) =>
      e.externalId === "tm-ap"
        ? {
            ...e,
            lineup: [
              { name: "AP Dhillon", tier: "headliner" as const, billingRank: 1 },
              { name: "New Act", tier: "support" as const, billingRank: 2 },
            ],
          }
        : e,
    );
    await mod.ingest(feed(changed), opts);
    const after = await eventRow(id);
    expect(after.lineup_hash).not.toBe(before.lineup_hash);
    const detail = await mod.getAdminEvent(id);
    expect(detail.lineup.map((l) => l.name)).toEqual(["AP Dhillon", "New Act"]);
    expect(await count("events")).toBe(3);
  });

  it("an unchanged lineup keeps lineup_hash", async () => {
    await mod.ingest(feed(FEED), opts);
    const id = await eventIdFor("tm-lolla");
    const before = await eventRow(id);
    await mod.ingest(feed(FEED), opts);
    expect((await eventRow(id)).lineup_hash).toBe(before.lineup_hash);
  });
});

describe("QA ingest: ingest_runs audit row", () => {
  it("records source, status, counts and finish time per run", async () => {
    await mod.ingest(feed(FEED), opts);
    await mod.ingest(feed(FEED.slice(0, 2)), opts);
    const rows = (await db.execute(
      sql`SELECT source, status, items_seen, items_new, finished_at, error FROM ingest_runs ORDER BY started_at, items_seen DESC`,
    )) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    const bySeen = rows.sort((a, b) => Number(b.items_seen) - Number(a.items_seen));
    expect(bySeen[0]).toMatchObject({
      source: "ticketmaster",
      status: "succeeded",
      items_seen: 3,
      items_new: 3,
      error: null,
    });
    expect(bySeen[1]).toMatchObject({ status: "succeeded", items_seen: 2, items_new: 0 });
    for (const r of rows) expect(r.finished_at).not.toBeNull();
  });

  it("an upstream failure closes the run as failed and rethrows", async () => {
    await expect(mod.ingest(failingFeed(FEED.slice(0, 1)), opts)).rejects.toBeInstanceOf(
      UpstreamError,
    );
    const rows = (await db.execute(
      sql`SELECT status, items_seen, finished_at, error FROM ingest_runs`,
    )) as unknown as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "failed", items_seen: 1 });
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(rows[0]!.error).toBeTruthy();
    // Work done before the failure is kept.
    expect(await count("events")).toBe(1);
  });
});

describe("QA ingest: admin precedence (D-026)", () => {
  it("Ticketmaster does not overwrite admin-edited fields or an admin lineup", async () => {
    await mod.ingest(feed(FEED), opts);
    const id = await eventIdFor("tm-ap");
    await mod.updateAdminEvent(id, {
      title: "AP Dhillon: Admin Title",
      genre: "Punjabi Pop",
      lineup: [
        { name: "AP Dhillon", tier: "headliner", billingRank: 1 },
        { name: "Admin Opener", tier: "support", billingRank: 2 },
      ],
    });
    const adminHash = (await eventRow(id)).lineup_hash;

    const tmChanged = FEED.map((e) =>
      e.externalId === "tm-ap"
        ? {
            ...e,
            title: "AP Dhillon Live (TM rename)",
            genre: "Hip-Hop",
            lineup: [{ name: "TM Act", tier: "headliner" as const, billingRank: 1 }],
          }
        : e,
    );
    await mod.ingest(feed(tmChanged), opts);
    const row = await eventRow(id);
    expect(row.title).toBe("AP Dhillon: Admin Title");
    expect(row.genre).toBe("Punjabi Pop");
    expect(row.lineup_hash).toBe(adminHash);
    const detail = await mod.getAdminEvent(id);
    expect(detail.lineup.map((l) => l.name)).toEqual(["AP Dhillon", "Admin Opener"]);
    expect(await count("events")).toBe(3);
  });

  it("an admin-created event absorbs the matching Ticketmaster event without losing admin fields", async () => {
    const created = await mod.createAdminEvent({
      title: "Lollapalooza India 2027",
      type: "festival",
      status: "full_lineup",
      startsAt: new Date("2027-01-25T10:30:00Z"),
      endsAt: null,
      genre: "Admin Genre",
      imageUrl: null,
      url: null,
      venue: { name: "Mahalakshmi Race Course", city: "Bombay", country: "IN" },
      lineup: [
        { name: "Headliner One", tier: "headliner", billingRank: 1 },
        { name: "Nucleya", tier: "sub", billingRank: 2 },
        { name: "Ritviz", tier: "sub", billingRank: 3 },
        { name: "Opener", tier: "support", billingRank: 4 },
      ],
    });
    await mod.ingest(feed([FEED[0]!]), opts);
    expect(await count("events")).toBe(1);
    expect(await count("venues")).toBe(1);
    const row = await eventRow(created.event.id);
    expect(row.genre).toBe("Admin Genre");
    expect(row.status).toBe("full_lineup");
    expect(await count("event_sources")).toBe(2);
  });
});

describe("QA ingest: cross-source dedupe", () => {
  it("a near-identical event from another source merges (venue alias + Bombay)", async () => {
    await mod.ingest(feed([FEED[0]!]), opts);
    const jb = ev({
      externalId: "jb-1",
      source: "jambase",
      title: "Lollapalooza India 2027",
      startsAt: new Date("2027-01-25T11:00:00Z"),
      venue: { name: "Mahalakshmi Race Course", city: "Bombay", country: "IN" },
    });
    const s = await mod.ingest(feed([jb], "jambase"), opts);
    expect(s.itemsNew).toBe(0);
    expect(await count("events")).toBe(1);
    expect(await count("event_sources")).toBe(2);
  });

  it("the same title in a different city is a different event", async () => {
    await mod.ingest(
      feed([
        FEED[0]!,
        ev({
          externalId: "tm-lolla-del",
          venue: { name: "JLN Stadium", city: "Delhi", country: "IN" },
        }),
      ]),
      opts,
    );
    expect(await count("events")).toBe(2);
  });

  it("raw payload is stored in event_sources for audit", async () => {
    await mod.ingest(feed([FEED[0]!]), opts);
    const rows = (await db.execute(sql`SELECT raw FROM event_sources`)) as unknown as {
      raw: unknown;
    }[];
    expect(JSON.stringify(rows[0]!.raw)).toContain("RAW-MARKER");
  });
});

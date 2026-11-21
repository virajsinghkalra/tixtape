import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestEvents } from "@/application/events/ingest-events";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { ValidatedCandidate } from "@/domain/events/extract/candidate";
import { verifyEvent } from "@/domain/events/extract/verify";
import type { RawEvent } from "@/domain/events/raw-event";
import { testDb } from "../../../tests/setup/db";
import { PgArtistRepository } from "./artist-repository";
import { PgEventCandidateRepository } from "./event-candidate-repository";
import { PgEventRepository } from "./event-repository";
import { PgEventVerificationRepository } from "./event-verification-repository";
import { truncateEventTables } from "./events-test-db";
import { PgIngestRunRepository } from "./ingest-run-repository";
import { PgLookupCache } from "./lookup-cache-repository";
import { PgVenueRepository } from "./venue-repository";

const db = testDb();
afterAll(() => db.$close());
beforeEach(async () => {
  await truncateEventTables(db);
  await db.execute(sql`TRUNCATE TABLE event_candidates`);
});

const now = new Date("2026-11-21T06:00:00Z");
const candidate: ValidatedCandidate = {
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
  artists: ["DJ Snake", "Anyma"],
  supportActs: [],
  confidence: 0.9,
  fingerprint: "text:sunburn",
};

async function storeEvent(raw: Partial<RawEvent> = {}) {
  const deps = {
    events: new PgEventRepository(db),
    venues: new PgVenueRepository(db),
    artists: new PgArtistRepository(db),
    ingestRuns: new PgIngestRunRepository(db),
    clock: { now: () => now },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const event: RawEvent = {
    source: "sunburn",
    externalId: "post:24000",
    title: "Sunburn Festival 2026",
    type: "festival",
    startsAt: candidate.startsAt,
    venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
    lineup: [{ name: "DJ Snake", tier: "headliner", billingRank: 1 }],
    raw: {},
    ...raw,
  };
  const adapter: SourceAdapter = {
    source: event.source,
    async *fetch() {
      yield event;
    },
  };
  await ingestEvents(deps, adapter, { from: now });
  return (await deps.events.findIdBySourceRef(event.source, event.externalId!))!;
}

describe("PgEventCandidateRepository", () => {
  it("upserts on (source, externalId), refreshes last seen, and links the event", async () => {
    const repo = new PgEventCandidateRepository(db);
    await repo.upsert(candidate, "sunburn festival|2026-12-17|mumbai", now);
    const later = new Date(now.getTime() + 3_600_000);
    await repo.upsert({ ...candidate, artists: ["DJ Snake", "Anyma", "Jason Derulo"] }, "k", later);
    const rows = await repo.listUpcoming(now, new Date(0));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lastSeenAt: later, publishedEventId: null });
    expect(rows[0]!.candidate).toEqual({
      ...candidate,
      artists: ["DJ Snake", "Anyma", "Jason Derulo"],
    });
    const eventId = await storeEvent();
    await repo.markPublished("sunburn", "post:24000", eventId);
    expect((await repo.listUpcoming(now, new Date(0)))[0]!.publishedEventId).toBe(eventId);
  });

  it("lists only upcoming candidates seen recently", async () => {
    const repo = new PgEventCandidateRepository(db);
    await repo.upsert(candidate, "k", now);
    expect(await repo.listUpcoming(new Date("2027-01-01T00:00:00Z"), new Date(0))).toEqual([]);
    expect(await repo.listUpcoming(now, new Date(now.getTime() + 1))).toEqual([]);
  });
});

describe("PgEventVerificationRepository", () => {
  it("stores events held by default, saves verification, and sets visibility", async () => {
    const repo = new PgEventVerificationRepository(db);
    const eventId = await storeEvent();
    expect((await repo.get(eventId))?.visibility).toBe("held");
    const verification = verifyEvent([candidate], { now });
    await repo.save(eventId, verification, now);
    await repo.setVisibility(eventId, "published");
    expect(await repo.get(eventId)).toMatchObject({
      visibility: "published",
      verification: { passes: true, confidence: verification.confidence },
    });
  });

  it("archives past events and reads past lineups of a series", async () => {
    const repo = new PgEventVerificationRepository(db);
    await storeEvent({
      externalId: "post:2025",
      title: "Sunburn Festival 2025",
      startsAt: new Date("2025-12-19T00:00:00+05:30"),
      lineup: [
        { name: "Martin Garrix", tier: "headliner", billingRank: 1 },
        { name: "KSHMR", tier: "sub", billingRank: 2 },
      ],
    });
    expect(await repo.pastLineups("sunburn festival", now)).toEqual([["Martin Garrix", "KSHMR"]]);
    expect(await repo.archivePast(now)).toBe(1);
    expect(await repo.archivePast(now)).toBe(0);
  });
});

describe("PgLookupCache", () => {
  it("runs uncached (no errors) until the lookup_cache table exists", async () => {
    const warn = vi.fn();
    const cache = new PgLookupCache(db, { warn });
    await db.execute(sql`DROP TABLE IF EXISTS lookup_cache`);
    expect(await cache.get("0".repeat(32), now)).toBeNull();
    await cache.set({
      lookupId: "0".repeat(32),
      queryKey: "coldplay",
      response: { status: "not_found" },
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stores and expires answers once the table exists", async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS lookup_cache (
        lookup_id text PRIMARY KEY, query_key text NOT NULL, response jsonb NOT NULL,
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    try {
      const cache = new PgLookupCache(db, { warn: vi.fn() });
      const id = "a".repeat(32);
      await cache.set({
        lookupId: id,
        queryKey: "coldplay",
        response: { status: "not_found", artists: [] },
        expiresAt: new Date(now.getTime() + 60_000),
      });
      expect(await cache.get(id, now)).toEqual({ status: "not_found", artists: [] });
      expect(await cache.get(id, new Date(now.getTime() + 61_000))).toBeNull();
    } finally {
      await db.execute(sql`DROP TABLE IF EXISTS lookup_cache`);
    }
  });
});

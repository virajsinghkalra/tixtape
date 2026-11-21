import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventStats, searchLog } from "@/db/schema";
import { TREND_HALF_LIFE_MS } from "@/domain/events/trend";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import { testDb } from "../../../tests/setup/db";
import { PgEventStatsRepository } from "./event-stats-repository";
import { truncateEventTables } from "./events-test-db";
import { PgSearchLogRepository } from "./search-log-repository";

const db = testDb();
const stats = new PgEventStatsRepository(db);
const log = new PgSearchLogRepository(db);
afterAll(() => db.$close());

const t0 = new Date("2026-11-25T06:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);
const MISSING = asEventId("00000000-0000-4000-8000-000000000000");
let eventId: EventId;

beforeEach(async () => {
  await truncateEventTables(db);
  await db.execute(sql`truncate table search_log, event_stats`);
  const [row] = await db
    .insert(events)
    .values({
      title: "NH7",
      type: "festival",
      startsAt: after(86_400_000),
      dedupeKey: "nh7",
      visibility: "published",
    })
    .returning({ id: events.id });
  eventId = asEventId(row!.id);
});

const statsRow = async () => (await db.select().from(eventStats))[0];

describe("PgEventStatsRepository", () => {
  it("counts each kind and adds its weight", async () => {
    await stats.record(eventId, "view", t0);
    await stats.record(eventId, "search_click", t0);
    await stats.record(eventId, "playlist_open", t0);
    expect(await statsRow()).toMatchObject({
      views: 1,
      searchClicks: 1,
      playlistOpens: 1,
      trendScore: 9,
      trendUpdatedAt: t0,
    });
  });

  it("decays with a 7-day half-life before adding (same maths as bumpTrend)", async () => {
    await stats.record(eventId, "search_click", t0); // 3
    await stats.record(eventId, "view", after(TREND_HALF_LIFE_MS)); // 3 × 0.5 + 1
    const row = await statsRow();
    expect(row!.trendScore).toBeCloseTo(2.5, 5);
    expect(row!.trendUpdatedAt).toEqual(after(TREND_HALF_LIFE_MS));
  });

  it("loses no bumps under concurrency", async () => {
    await Promise.all(Array.from({ length: 20 }, () => stats.record(eventId, "view", t0)));
    expect(await statsRow()).toMatchObject({ views: 20, trendScore: 20 });
  });

  it("404s an unknown event", async () => {
    await expect(stats.record(MISSING, "view", t0)).rejects.toThrow(NotFoundError);
  });

  it.each(["held", "archived"] as const)(
    "treats a %s event as not found and bumps nothing (D-056)",
    async (visibility) => {
      await db.update(events).set({ visibility }).where(eq(events.id, eventId));
      expect(await stats.isPublished(eventId)).toBe(false);
      await expect(stats.record(eventId, "view", t0)).rejects.toThrow(NotFoundError);
      expect(await statsRow()).toBeUndefined();
    },
  );

  it("isPublished is true only for an existing published event", async () => {
    expect(await stats.isPublished(eventId)).toBe(true);
    expect(await stats.isPublished(MISSING)).toBe(false);
  });
});

describe("PgSearchLogRepository", () => {
  it("marks the latest matching search as clicked, or logs a clicked search", async () => {
    await log.recordSearch("lolla", 3, t0);
    await log.recordClick("lolla", eventId, after(60_000));
    await log.recordClick("nh7", eventId, after(60_000)); // no prior search
    await log.recordClick("lolla", eventId, after(2 * 3_600_000)); // too late to belong to it
    const rows = await db
      .select({
        q: searchLog.queryNormalized,
        n: searchLog.resultsCount,
        clicked: searchLog.clickedEventId,
      })
      .from(searchLog)
      .orderBy(searchLog.createdAt, searchLog.queryNormalized);
    expect(rows).toEqual([
      { q: "lolla", n: 3, clicked: eventId },
      { q: "nh7", n: 1, clicked: eventId },
      { q: "lolla", n: 1, clicked: eventId },
    ]);
  });

  it("stores no user or client data", async () => {
    const cols = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'search_log'`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      "clicked_event_id",
      "created_at",
      "id",
      "query_normalized",
      "results_count",
    ]);
  });

  it("lists zero-result queries for the admin and prunes old rows", async () => {
    await log.recordSearch("coldplay", 0, t0);
    await log.recordSearch("coldplay", 0, t0);
    await log.recordSearch("techno", 0, t0);
    await log.recordSearch("lolla", 2, t0);
    await log.recordSearch("old", 0, after(-100 * 86_400_000));
    expect(await log.listZeroResultQueries(after(-86_400_000), 10)).toEqual([
      { query: "coldplay", count: 2 },
      { query: "techno", count: 1 },
    ]);
    expect(await log.deleteOlderThan(after(-90 * 86_400_000))).toBe(1);
    expect(await db.select().from(searchLog)).toHaveLength(4);
  });

  it("404s a click on an unknown event", async () => {
    await expect(log.recordClick("x", MISSING, t0)).rejects.toThrow(NotFoundError);
  });
});

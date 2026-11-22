import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { analyticsEvents, devices, events, eventStats, searchLog } from "@/db/schema";
import { TREND_HALF_LIFE_MS } from "@/domain/events/trend";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { testDb } from "../../../tests/setup/db";
import { PgEventStatsRollup } from "./event-stats-repository";
import { truncateEventTables } from "./events-test-db";
import { PgSearchLogRepository } from "./search-log-repository";

const db = testDb();
const rollup = new PgEventStatsRollup(db);
const log = new PgSearchLogRepository(db);
afterAll(() => db.$close());

const t0 = new Date("2026-11-25T06:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);
let eventId: EventId;

beforeEach(async () => {
  await truncateEventTables(db);
  await db.execute(sql`truncate table search_log, event_stats, analytics_events, devices cascade`);
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

/** One device and its analytics events, as the D-090 beacon stores them. */
async function device(id: string) {
  await db.insert(devices).values({ id, firstSeen: t0, lastSeen: t0, firstSource: "direct" });
  return id;
}
async function act(deviceId: string | null, name: string, props: object, at: Date) {
  await db.insert(analyticsEvents).values({ deviceId, name, props, source: "direct", at });
}
const now = after(60 * 60_000);

describe("PgEventStatsRollup (QA-F-7)", () => {
  it("weighs a view 1, a search click-through 3 and a playlist open 5", async () => {
    const a = await device("10000000-0000-4000-8000-00000000000a");
    const b = await device("10000000-0000-4000-8000-00000000000b");
    const c = await device("10000000-0000-4000-8000-00000000000c");
    await act(a, "event_open", { eventId }, t0);
    await act(b, "search", { q: "nh7", results: 1 }, t0);
    await act(b, "event_open", { eventId }, after(5 * 60_000));
    await act(c, "playlist_make", { eventId }, t0);
    await act(c, "page_view", { path: "event" }, t0);
    expect(await rollup.rollup(now)).toEqual({ events: 1 });
    expect(await statsRow()).toMatchObject({ views: 1, searchClicks: 1, playlistOpens: 1 });
    // 1 + 3 + 5, less under an hour's decay (half-life 7 days).
    expect((await statsRow())!.trendScore).toBeCloseTo(9, 1);
  });

  it("a search more than 30 minutes earlier doesn't make it a click-through", async () => {
    const a = await device("10000000-0000-4000-8000-00000000000a");
    await act(a, "search", { q: "nh7", results: 1 }, t0);
    await act(a, "event_open", { eventId }, after(31 * 60_000));
    await rollup.rollup(now);
    expect(await statsRow()).toMatchObject({ views: 1, searchClicks: 0 });
  });

  it("counts a device once per event, kind and IST day, so reloads don't inflate it", async () => {
    const a = await device("10000000-0000-4000-8000-00000000000a");
    for (let i = 0; i < 5; i++) await act(a, "event_open", { eventId }, after(i * 60_000));
    await act(a, "event_open", { eventId }, after(86_400_000));
    await rollup.rollup(after(86_400_000 + 60_000));
    expect((await statsRow())!.views).toBe(2);
  });

  it("decays with the 7-day half-life", async () => {
    const a = await device("10000000-0000-4000-8000-00000000000a");
    await act(a, "event_open", { eventId }, t0);
    await rollup.rollup(after(TREND_HALF_LIFE_MS));
    expect((await statsRow())!.trendScore).toBeCloseTo(0.5, 5);
  });

  it("counts anonymised events (device erased) one by one", async () => {
    await act(null, "event_open", { eventId }, t0);
    await act(null, "event_open", { eventId }, t0);
    await rollup.rollup(now);
    expect((await statsRow())!.views).toBe(2);
  });

  it("is idempotent, and gives hidden events no stats", async () => {
    const a = await device("10000000-0000-4000-8000-00000000000a");
    await act(a, "event_open", { eventId }, t0);
    await rollup.rollup(now);
    const first = await statsRow();
    await rollup.rollup(now);
    expect(await statsRow()).toEqual(first);

    await db.update(events).set({ visibility: "held" }).where(eq(events.id, eventId));
    expect(await rollup.rollup(now)).toEqual({ events: 0 });
    expect(await statsRow()).toMatchObject({ views: 0, trendScore: 0 });
  });
});

describe("PgSearchLogRepository", () => {
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
});

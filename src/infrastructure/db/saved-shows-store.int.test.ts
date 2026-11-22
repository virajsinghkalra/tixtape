import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { savedShows } from "@/db/schema";
import { CONSENT_VERSION } from "@/domain/analytics/identity";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgAnalyticsStore } from "./analytics-store";
import { PgEventStatsRollup } from "./event-stats-repository";
import { PgSavedShowsStore } from "./saved-shows-store";

const db = testDb();
const analytics = new PgAnalyticsStore(db);
const store = new PgSavedShowsStore(db);
const T = (h: number) => new Date(Date.UTC(2026, 10, 20, h));

async function event(visibility: "published" | "held" = "published"): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into events (id, title, type, starts_at, dedupe_key, visibility)
    values (${id}, ${"Show " + id.slice(0, 4)}, 'concert', '2026-12-01T14:00:00Z', ${id}, ${visibility})`);
  return id;
}
async function emailed(email: string): Promise<string> {
  const did = randomUUID();
  await analytics.saveContact(
    did,
    { email, personName: null, source: "remind", consentVersion: CONSENT_VERSION },
    T(0),
  );
  return did;
}

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgSavedShowsStore (D-092)", () => {
  it("anonymous and nickname-only devices stay local-only", async () => {
    const e = await event();
    const anon = randomUUID();
    expect(await store.apply(anon, { saves: [{ eventId: e, at: T(1) }], removes: [] })).toBe(false);
    const nick = randomUUID();
    await analytics.setNickname(nick, "Vee", T(0));
    expect(await store.apply(nick, { saves: [{ eventId: e, at: T(1) }], removes: [] })).toBe(false);
    expect(await store.list(nick)).toEqual({ synced: false, shows: [] });
    expect(await db.select().from(savedShows)).toHaveLength(0);
  });

  it("saves and unsaves for an emailed person; the latest action wins", async () => {
    const e = await event();
    const did = await emailed("a@example.com");
    await store.apply(did, { saves: [{ eventId: e, at: T(2) }], removes: [] });
    await store.apply(did, { saves: [], removes: [{ eventId: e, at: T(3) }] });
    // A replayed older save can't move saved_at backwards past the unsave.
    await store.apply(did, { saves: [{ eventId: e, at: T(1) }], removes: [] });
    const { synced, shows } = await store.list(did);
    expect(synced).toBe(true);
    expect(shows).toEqual([
      {
        eventId: e,
        savedAt: T(2).toISOString(),
        removedAt: T(3).toISOString(),
        show: {
          title: expect.stringMatching(/^Show /),
          startsAt: "2026-12-01T14:00:00.000Z",
          city: null,
        },
      },
    ]);
  });

  it("skips unknown events and hides held ones' details", async () => {
    const held = await event("held");
    const did = await emailed("b@example.com");
    await store.apply(did, {
      saves: [
        { eventId: held, at: T(1) },
        { eventId: randomUUID(), at: T(1) },
      ],
      removes: [],
    });
    const { shows } = await store.list(did);
    expect(shows.map((s) => [s.eventId, s.show])).toEqual([[held, null]]);
  });

  it("never returns another person's shows", async () => {
    const e = await event();
    const a = await emailed("c@example.com");
    const b = await emailed("d@example.com");
    await store.apply(a, { saves: [{ eventId: e, at: T(1) }], removes: [] });
    expect((await store.list(b)).shows).toEqual([]);
  });

  it("Delete my data deletes saved shows", async () => {
    const e = await event();
    const did = await emailed("e@example.com");
    await store.apply(did, { saves: [{ eventId: e, at: T(1) }], removes: [] });
    await analytics.deleteDeviceData(did);
    expect(await db.select().from(savedShows)).toHaveLength(0);
  });

  it("a save feeds trending with weight 2 (event_stats rollup)", async () => {
    const e = await event();
    const now = new Date();
    await analytics.record(
      {
        deviceId: randomUUID(),
        source: { source: "direct", medium: null, campaign: null },
        city: null,
        at: now,
      },
      [{ n: "save", p: { eventId: e } }],
    );
    await new PgEventStatsRollup(db).rollup(now);
    const [row] = await db.execute<{ trend_score: number }>(
      sql`select trend_score from event_stats where event_id = ${e}`,
    );
    expect(row?.trend_score).toBeCloseTo(2, 3);
  });
});

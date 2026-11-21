import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loadRunPlan } from "@/application/gigs/run-discovery";
import { testDb } from "../../../tests/setup/db";
import { PgArtistCities, PgCityDemandStore, PgCityShowCounts } from "./pg-demand-stores";

const db = testDb();
afterAll(() => db.$close());
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE city_demand, event_artists, events, venues, artists RESTART IDENTITY CASCADE`,
  );
});

const now = new Date("2026-11-22T10:00:00+05:30");

async function event(city: string, visibility: string, startsAt: string, artist: string) {
  const [v] = await db.execute<{ id: string }>(sql`
    insert into venues (name, normalized_name, city, country)
    values (${`Hall ${city} ${startsAt}`}, ${`hall ${city} ${startsAt}`.toLowerCase()}, ${city}, 'IN') returning id`);
  const [e] = await db.execute<{ id: string }>(sql`
    insert into events (title, type, venue_id, starts_at, dedupe_key, visibility)
    values (${`${artist} Live`}, 'concert', ${v!.id}::uuid, ${startsAt}::timestamptz,
      ${`${artist}|${startsAt}|${city}`}, ${visibility}::event_visibility) returning id`);
  const [a] = await db.execute<{ id: string }>(sql`
    insert into artists (name, normalized_name) values (${artist}, ${artist.toLowerCase()})
    on conflict do nothing returning id`);
  const artistId =
    a?.id ??
    (await db.execute<{ id: string }>(sql`select id from artists where name = ${artist}`))[0]!.id;
  await db.execute(sql`insert into event_artists (event_id, artist_id, billing_rank, tier)
    values (${e!.id}::uuid, ${artistId}::uuid, 1, 'headliner')`);
}

describe("city demand (D-081)", () => {
  it("counts per IST day, city and kind, and stores nothing else", async () => {
    const store = new PgCityDemandStore(db);
    await store.record("Mumbai", "view", now);
    await store.record("Mumbai", "view", now);
    await store.record("Mumbai", "search", now);
    // 23:30 IST on the 21st is still the 21st in India.
    await store.record("Mumbai", "view", new Date("2026-11-21T18:00:00Z"));
    const rows = await store.since("2026-11-21");
    expect(rows.sort((a, b) => (a.day + a.kind).localeCompare(b.day + b.kind))).toEqual([
      { day: "2026-11-21", city: "Mumbai", kind: "view", count: 1 },
      { day: "2026-11-22", city: "Mumbai", kind: "search", count: 1 },
      { day: "2026-11-22", city: "Mumbai", kind: "view", count: 2 },
    ]);
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns where table_name = 'city_demand' order by 1`);
    expect(columns.map((c) => c.column_name)).toEqual(["city", "count", "day", "kind"]);
    expect(await store.since("2026-11-23")).toEqual([]);
  });

  it("counts upcoming published shows per city and lists where artists play", async () => {
    await event("Mumbai", "published", "2026-12-05T14:00:00Z", "Bhuwin");
    await event("Mumbai", "held", "2026-12-06T14:00:00Z", "Bhuwin");
    await event("Pune", "published", "2026-12-10T14:00:00Z", "Prateek Kuhad");
    await event("Delhi", "published", "2026-01-10T14:00:00Z", "Old Act");
    expect(
      (await new PgCityShowCounts(db).upcomingPublished(now)).sort((a, b) =>
        a.city.localeCompare(b.city),
      ),
    ).toEqual([
      { city: "Mumbai", count: 1 },
      { city: "Pune", count: 1 },
    ]);
    const cities = await new PgArtistCities(db).list(new Date("2026-06-01T00:00:00Z"));
    expect(cities.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Bhuwin", city: "Mumbai" },
      { name: "Prateek Kuhad", city: "Pune" },
    ]);
  });

  it("plans a run from the real tables: Mumbai metro (Mumbai + Pune) has few shows, so it goes first", async () => {
    await event("Mumbai", "published", "2026-12-05T14:00:00Z", "Bhuwin");
    await event("Bengaluru", "published", "2026-12-07T14:00:00Z", "Ritviz");
    for (let i = 0; i < 6; i++) {
      await event("Bengaluru", "published", `2026-12-1${i}T14:00:00Z`, `Blr Act ${i}`);
    }
    const store = new PgCityDemandStore(db);
    for (let i = 0; i < 5; i++) await store.record("Pune", "view", now);
    for (let i = 0; i < 9; i++) await store.record("Bengaluru", "view", now);
    const { plan, artistCities } = await loadRunPlan(
      {
        demand: store,
        shows: new PgCityShowCounts(db),
        artistCities: new PgArtistCities(db),
        clock: { now: () => now },
        logger: { warn: () => {} },
      },
      10,
    );
    expect(plan.metros.map((m) => [m.metro, m.upcoming, m.scarce])).toEqual([
      ["mumbai", 1, true],
      ["bengaluru", 7, false],
    ]);
    expect(artistCities).toContainEqual({ name: "Bhuwin", city: "Mumbai" });
  });
});

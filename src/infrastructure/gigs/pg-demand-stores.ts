/**
 * D-081 Postgres adapters: city demand counters (upsert-increment, no personal data), upcoming
 * published shows per city, and the cities our artists play in.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { ArtistCities, CityDemandStore, CityShowCounts } from "@/application/gigs/ports";
import type { Database } from "@/db/client";
import { artists, cityDemand, eventArtists, events, venues } from "@/db/schema";
import { isoDate } from "@/domain/gigs/extract";
import type { DemandCount, DemandKind } from "@/domain/gigs/demand";

export class PgCityDemandStore implements CityDemandStore {
  constructor(private readonly db: Database) {}

  async record(city: string, kind: DemandKind, at: Date): Promise<void> {
    await this.db
      .insert(cityDemand)
      .values({ day: isoDate(at), city, kind, count: 1 })
      .onConflictDoUpdate({
        target: [cityDemand.day, cityDemand.city, cityDemand.kind],
        set: { count: sql`${cityDemand.count} + 1` },
      });
  }

  async since(sinceDay: string): Promise<DemandCount[]> {
    return this.db
      .select({
        day: cityDemand.day,
        city: cityDemand.city,
        kind: cityDemand.kind,
        count: cityDemand.count,
      })
      .from(cityDemand)
      .where(gte(cityDemand.day, sinceDay));
  }
}

export class PgCityShowCounts implements CityShowCounts {
  constructor(private readonly db: Database) {}

  async upcomingPublished(now: Date) {
    const rows = await this.db
      .select({ city: venues.city, count: sql<number>`count(*)::int` })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(
        and(
          eq(events.visibility, "published"),
          sql`coalesce(${events.endsAt}, ${events.startsAt}) >= ${now.toISOString()}::timestamptz`,
        ),
      )
      .groupBy(venues.city);
    return rows.map((r) => ({ city: r.city, count: Number(r.count) }));
  }
}

export class PgArtistCities implements ArtistCities {
  constructor(private readonly db: Database) {}

  /** Distinct (artist, city) pairs from lineups of events starting since `since`, any visibility. */
  async list(since: Date) {
    return this.db
      .selectDistinct({ name: artists.name, city: venues.city })
      .from(eventArtists)
      .innerJoin(events, eq(events.id, eventArtists.eventId))
      .innerJoin(venues, eq(venues.id, events.venueId))
      .innerJoin(artists, eq(artists.id, eventArtists.artistId))
      .where(
        and(
          gte(events.startsAt, since),
          inArray(events.visibility, ["held", "published", "archived"]),
        ),
      );
  }
}

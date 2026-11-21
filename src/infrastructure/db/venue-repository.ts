import { and, eq, inArray, or, sql } from "drizzle-orm";
import type {
  NewVenue,
  Venue,
  VenueRepository,
  VenueWithAliases,
} from "@/application/ports/venues";
import type { Database } from "@/db/client";
import { venueAliases, venues } from "@/db/schema";
import { asVenueId, type VenueId } from "@/domain/shared/ids";

type VenueRow = typeof venues.$inferSelect;

const toVenue = (row: VenueRow): Venue => ({
  id: asVenueId(row.id),
  name: row.name,
  normalizedName: row.normalizedName,
  city: row.city,
  state: row.state,
  country: row.country,
  lat: row.lat,
  lng: row.lng,
});

export class PgVenueRepository implements VenueRepository {
  constructor(private readonly db: Database) {}

  async findById(id: VenueId): Promise<Venue | null> {
    const rows = await this.db.select().from(venues).where(eq(venues.id, id));
    return rows[0] ? toVenue(rows[0]) : null;
  }

  async findByName(normalizedName: string, city: string): Promise<Venue | null> {
    const aliased = this.db
      .select({ id: venueAliases.venueId })
      .from(venueAliases)
      .where(eq(venueAliases.aliasNormalized, normalizedName));
    const rows = await this.db
      .select()
      .from(venues)
      .where(
        and(
          eq(venues.city, city),
          or(eq(venues.normalizedName, normalizedName), inArray(venues.id, aliased)),
        ),
      )
      // An exact name beats an alias if both exist.
      .orderBy(sql`${venues.normalizedName} = ${normalizedName} desc`, venues.createdAt)
      .limit(1);
    return rows[0] ? toVenue(rows[0]) : null;
  }

  async listByCity(city: string, country: string): Promise<VenueWithAliases[]> {
    const rows = await this.db
      .select({
        venue: venues,
        aliases: sql<
          string[]
        >`coalesce(array_agg(${venueAliases.aliasNormalized}) filter (where ${venueAliases.aliasNormalized} is not null), '{}')`,
      })
      .from(venues)
      .leftJoin(venueAliases, eq(venueAliases.venueId, venues.id))
      .where(and(eq(venues.city, city), eq(venues.country, country)))
      .groupBy(venues.id);
    return rows.map((r) => ({ ...toVenue(r.venue), aliases: r.aliases }));
  }

  async create(venue: NewVenue): Promise<Venue> {
    const inserted = await this.db
      .insert(venues)
      .values(venue)
      .onConflictDoNothing({ target: [venues.normalizedName, venues.city] })
      .returning();
    if (inserted[0]) return toVenue(inserted[0]);
    const existing = await this.db
      .select()
      .from(venues)
      .where(and(eq(venues.normalizedName, venue.normalizedName), eq(venues.city, venue.city)));
    if (!existing[0]) throw new Error("venue insert conflicted but no row was found");
    return toVenue(existing[0]);
  }

  async addAlias(venueId: VenueId, aliasNormalized: string): Promise<void> {
    await this.db.insert(venueAliases).values({ venueId, aliasNormalized }).onConflictDoNothing();
  }
}

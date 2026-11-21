/** Venue persistence (P1.4). Implemented in src/infrastructure/db/venue-repository.ts. */
import type { VenueId } from "@/domain/shared/ids";

export type Venue = {
  id: VenueId;
  name: string;
  normalizedName: string;
  /** Canonical display name (`canonicalCity`), e.g. "Mumbai". */
  city: string;
  state: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
};

export type NewVenue = Omit<Venue, "id">;

export type VenueWithAliases = Venue & { aliases: string[] };

export interface VenueRepository {
  findById(id: VenueId): Promise<Venue | null>;
  /** Exact match on (normalized name, city) or on an alias in that city. */
  findByName(normalizedName: string, city: string): Promise<Venue | null>;
  /** Every venue in a city, with aliases, for fuzzy matching. */
  listByCity(city: string, country: string): Promise<VenueWithAliases[]>;
  /** Inserts, or returns the existing row for the same (normalized name, city). Idempotent. */
  create(venue: NewVenue): Promise<Venue>;
  /** Idempotent. */
  addAlias(venueId: VenueId, aliasNormalized: string): Promise<void>;
}

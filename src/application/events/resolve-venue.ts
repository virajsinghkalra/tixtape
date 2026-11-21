import type { Venue, VenueRepository } from "@/application/ports/venues";
import type { RawVenue } from "@/domain/events/raw-event";
import { bestVenueMatch, canonicalCity, normalizeVenueName } from "@/domain/events/venue";

/**
 * Finds the stored venue for a source's venue, or creates it (P1.4).
 * Order: exact normalized name or alias in the city → fuzzy match (Jaro-Winkler ≥ 0.95)
 * against that city's venues, recording the new spelling as an alias → new venue.
 */
export async function resolveVenue(venues: VenueRepository, raw: RawVenue): Promise<Venue> {
  const city = canonicalCity(raw.city);
  const normalizedName = normalizeVenueName(raw.name, city);
  const exact = await venues.findByName(normalizedName, city);
  if (exact) return exact;

  const inCity = await venues.listByCity(city, raw.country);
  const fuzzy = bestVenueMatch(
    normalizedName,
    inCity.map((v) => ({ venue: v, normalizedNames: [v.normalizedName, ...v.aliases] })),
  );
  if (fuzzy) {
    await venues.addAlias(fuzzy.venue.id, normalizedName);
    const { aliases: _aliases, ...venue } = fuzzy.venue;
    return venue;
  }

  return venues.create({
    name: raw.name,
    normalizedName,
    city,
    state: raw.state ?? null,
    country: raw.country,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
  });
}

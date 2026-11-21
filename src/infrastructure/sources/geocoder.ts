/**
 * Venue geocoding with Nominatim (D-051, D-056 layer 3): which city a venue lies in.
 * Usage policy: ≤ 1 request/s, identifying User-Agent, results cached (here: forever in the
 * collector state). Attribution: © OpenStreetMap contributors (ODbL).
 */
import { z } from "zod";
import type { VenueGeocoder } from "@/application/ingestion/ports";
import { findCity } from "@/domain/events/extract/places";
import { foldText } from "@/domain/events/text";
import type { PoliteFetcher } from "./polite-fetch";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

const ResultSchema = z.array(
  z.object({
    address: z
      .object({
        city: z.string().optional(),
        town: z.string().optional(),
        city_district: z.string().optional(),
        state_district: z.string().optional(),
        county: z.string().optional(),
        suburb: z.string().optional(),
      })
      .optional(),
  }),
);

export interface GeocodeCache {
  getGeocode(key: string): Promise<{ city: string | null } | undefined>;
  setGeocode(key: string, city: string | null): Promise<void>;
}

export class NominatimGeocoder implements VenueGeocoder {
  constructor(private readonly deps: { fetcher: PoliteFetcher; cache: GeocodeCache }) {}

  async cityOf(venue: string, city: string): Promise<string | null> {
    // v2: address fields are scanned for a city name ("Mumbai City District" → Mumbai).
    const key = `v2|${foldText(`${venue}|${city}`)}`;
    const cached = await this.deps.cache.getGeocode(key);
    if (cached) return cached.city;
    const url = new URL(NOMINATIM);
    url.search = new URLSearchParams({
      q: `${venue}, ${city}, India`,
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
      countrycodes: "in",
    }).toString();
    const parsed = ResultSchema.safeParse(
      JSON.parse(
        await this.deps.fetcher.getText(url.href, {
          accept: "application/json",
          policy: "api-etiquette",
        }),
      ),
    );
    const address = parsed.success ? parsed.data[0]?.address : undefined;
    const found = address
      ? ([
          address.city,
          address.town,
          address.city_district,
          address.state_district,
          address.county,
          address.suburb,
        ]
          .map((v) => (v ? findCity(v) : null))
          .find((c) => c !== null) ?? null)
      : null;
    await this.deps.cache.setGeocode(key, found);
    return found;
  }
}

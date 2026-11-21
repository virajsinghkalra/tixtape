import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HeadlinerIdentity } from "@/domain/events/extract/verify";
import { NominatimGeocoder, type GeocodeCache } from "./geocoder";
import { WikidataMusicBrainzIdentity, type IdentityCache } from "./identity";
import { createMemoryHostLog, PoliteFetcher } from "./polite-fetch";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const clock = { now: () => new Date("2026-11-21T10:00:00Z") };
const fetcher = () =>
  new PoliteFetcher({
    fetch: (...args) => fetch(...args),
    sleep: vi.fn(async () => {}),
    clock,
    logger: { warn: vi.fn() },
    hostLog: createMemoryHostLog(),
    resolve: async () => ["93.184.216.34"],
  });

function memoryCaches(): IdentityCache & GeocodeCache {
  const ids = new Map<string, { value: HeadlinerIdentity | null; checkedAt: Date }>();
  const geo = new Map<string, { city: string | null }>();
  return {
    getIdentity: async (k) => ids.get(k),
    setIdentity: async (k, value, checkedAt) => void ids.set(k, { value, checkedAt }),
    getGeocode: async (k) => geo.get(k),
    setGeocode: async (k, city) => void geo.set(k, { city }),
  };
}

const SPOTIFY_ID = "2FKWNmZWDBZR4dE5KX4plR";
const MBID = "b7ffd2af-418f-4be2-bdd1-22f8b48613da";

describe("WikidataMusicBrainzIdentity", () => {
  it("follows Spotify ID → Wikidata → MusicBrainz to the latest release year, and caches it", async () => {
    let calls = 0;
    server.use(
      http.get("https://www.wikidata.org/w/api.php", ({ request }) => {
        calls++;
        const url = new URL(request.url);
        if (url.searchParams.get("action") === "query") {
          expect(url.searchParams.get("srsearch")).toBe(`haswbstatement:P1902=${SPOTIFY_ID}`);
          return HttpResponse.json({ query: { search: [{ title: "Q5276896" }] } });
        }
        return HttpResponse.json({
          entities: {
            Q5276896: { claims: { P434: [{ mainsnak: { datavalue: { value: MBID } } }] } },
          },
        });
      }),
      http.get("https://musicbrainz.org/ws/2/release-group", () => {
        calls++;
        return HttpResponse.json({
          "release-groups": [
            { "first-release-date": "2016-01-01" },
            { "first-release-date": "2025-06-27" },
            {},
          ],
        });
      }),
    );
    const identity = new WikidataMusicBrainzIdentity({
      fetcher: fetcher(),
      cache: memoryCaches(),
      clock,
    });
    const expected = { wikidataId: "Q5276896", mbid: MBID, lastReleaseYear: 2025 };
    expect(await identity.lookup(SPOTIFY_ID)).toEqual(expected);
    expect(await identity.lookup(SPOTIFY_ID)).toEqual(expected);
    expect(calls).toBe(3);
  });

  it("returns null for an artist Wikidata doesn't know, and for malformed IDs", async () => {
    server.use(
      http.get("https://www.wikidata.org/w/api.php", () =>
        HttpResponse.json({ query: { search: [] } }),
      ),
    );
    const identity = new WikidataMusicBrainzIdentity({
      fetcher: fetcher(),
      cache: memoryCaches(),
      clock,
    });
    expect(await identity.lookup(SPOTIFY_ID)).toBeNull();
    expect(await identity.lookup("not-an-id")).toBeNull();
  });
});

describe("NominatimGeocoder", () => {
  it("returns the known Indian city the venue lies in, and caches it", async () => {
    let calls = 0;
    server.use(
      http.get("https://nominatim.openstreetmap.org/search", ({ request }) => {
        calls++;
        expect(new URL(request.url).searchParams.get("q")).toBe(
          "Mahalaxmi Racecourse, Mumbai, India",
        );
        // The real answer for this venue has no `city`, only "Mumbai City District".
        return HttpResponse.json([
          {
            address: {
              suburb: "Mahalakshmi",
              city_district: "Mumbai Zone 2",
              state_district: "Mumbai City District",
              state: "Maharashtra",
            },
          },
        ]);
      }),
    );
    const geocoder = new NominatimGeocoder({ fetcher: fetcher(), cache: memoryCaches() });
    expect(await geocoder.cityOf("Mahalaxmi Racecourse", "Mumbai")).toBe("Mumbai");
    expect(await geocoder.cityOf("Mahalaxmi Racecourse", "Mumbai")).toBe("Mumbai");
    expect(calls).toBe(1);
  });

  it("returns null when nothing is found", async () => {
    server.use(http.get("https://nominatim.openstreetmap.org/search", () => HttpResponse.json([])));
    const geocoder = new NominatimGeocoder({ fetcher: fetcher(), cache: memoryCaches() });
    expect(await geocoder.cityOf("Nowhere Arena", "Pune")).toBeNull();
  });
});

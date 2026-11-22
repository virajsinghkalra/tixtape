import { z } from "zod";
import {
  MATCH_REASONS,
  SearchHttpError,
  SECTION_IDS,
  type RecommendationSection,
  type SearchSource,
  type SuggestResponse,
} from "./types";

export const MAX_RESULTS = 8;

/**
 * Which D-047 endpoints are live. The UI is built for all of them. A flag turns a feature on
 * once its endpoint ships, so the browser never makes calls that 404 or 400 in the meantime.
 * - recommendations: `GET /api/events/suggest?q=` (empty q). Until then: server-built sections.
 */
export const SEARCH_CAPABILITIES = { recommendations: false } as const;

const eventResult = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  startsAt: z.string(),
  startsAtDateOnly: z.boolean().default(false),
  city: z.string().nullable().default(null),
  venueName: z.string().nullable().default(null),
  matchReason: z.enum(MATCH_REASONS).default("title"),
  matchedText: z.string().default(""),
  matchedArtist: z.string().optional(),
});

/** Today's server sends only `results`; the D-047 fields default to empty. */
const suggestResponse = z.object({
  results: z.array(eventResult).default([]),
  artists: z
    .array(
      z.object({
        name: z.string(),
        spotifyId: z.string().optional(),
        imageUrl: z.string().optional(),
        upcomingCount: z.number().int().min(0),
        matchedText: z.string().default(""),
        onlyEventId: z.string().optional(),
      }),
    )
    .default([]),
  cities: z
    .array(z.object({ city: z.string(), upcomingCount: z.number().int().min(0) }))
    .default([]),
  filters: z
    .object({
      city: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      type: z.string().optional(),
      genre: z.string().optional(),
    })
    .default({}),
  fallback: z.array(eventResult).default([]),
  didYouMean: z.string().optional(),
});

const recommendations = z.object({
  sections: z.array(
    z.object({
      id: z.enum(SECTION_IDS),
      title: z.string(),
      items: z.array(eventResult).optional(),
      queries: z.array(z.string()).optional(),
    }),
  ),
});

async function getJson(url: string, signal: AbortSignal, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new SearchHttpError(res.status);
  return res.json();
}

/** Typed search: fuzzy, alias, artist, venue and city matches, ranked by the server. */
export function suggestSource(fetchFn: typeof fetch = fetch): SearchSource {
  return async ({ query, city }, signal) => {
    const params = new URLSearchParams({ q: query });
    if (city) params.set("city", city);
    const body = suggestResponse.parse(
      await getJson(`/api/events/suggest?${params}`, signal, fetchFn),
    );
    return { ...body, results: body.results.slice(0, MAX_RESULTS) } satisfies SuggestResponse;
  };
}

/** Zero-query recommendations (D-047). Only called when `SEARCH_CAPABILITIES.recommendations`. */
export async function fetchRecommendations(
  signal: AbortSignal,
  city: string | null = null,
  fetchFn: typeof fetch = fetch,
): Promise<RecommendationSection[]> {
  const params = new URLSearchParams({ q: "" });
  if (city) params.set("city", city);
  return recommendations.parse(await getJson(`/api/events/suggest?${params}`, signal, fetchFn))
    .sections;
}

export const defaultSearchSource: SearchSource = suggestSource();

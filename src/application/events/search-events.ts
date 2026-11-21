/**
 * One search service, two shapes (D-047, D-048): `suggest` for the type-ahead
 * (`/api/events/suggest`) and `searchPage` for the full results page (`/api/search`).
 */
import { z } from "zod";
import type { SearchLog } from "@/application/ports/engagement";
import type { EventSearch } from "@/application/ports/event-search";
import { weekendWindow } from "@/domain/events/ist-calendar";
import {
  asListing,
  buildSearchQuery,
  didYouMean,
  planSearch,
  rankArtists,
  rankCities,
  rankSuggestions,
  SUGGEST_LIMIT,
  SUGGEST_MAX_LENGTH,
  SUGGEST_MIN_LENGTH,
  tidyQuery,
  type ArtistEntity,
  type CityEntity,
  type EventResult,
  type SearchFilters,
  type Suggestion,
} from "@/domain/events/search";
import { buildSections, SECTION_SIZE, type Section } from "@/domain/events/sections";
import { foldText } from "@/domain/events/text";
import { canonicalCity } from "@/domain/events/venue";
import { EVENT_TYPES } from "@/domain/shared/lineup";
import type { Logger } from "@/lib/logger";
import { dateOrDateTime, endOfDayIfDate } from "./read-events";

const SUGGEST_CANDIDATES = 200;
const PAGE_CANDIDATES = 500;
const FALLBACK_SIZE = 5;
export const MAX_PAGE_SIZE = 50;
const POPULAR_WINDOW_MS = 7 * 86_400_000;

export type SearchDeps = {
  search: EventSearch;
  searchLog: SearchLog;
  clock: { now(): Date };
  logger: Pick<Logger, "warn">;
};

// ── Input ─────────────────────────────────────────────────────────────────

const lengthOf = (s: string) => [...s].length;

/** Optional free text: empty means "no text"; otherwise 2–100 characters after tidying. */
const queryText = z
  .string()
  .transform(tidyQuery)
  .refine((q) => q === "" || lengthOf(q) >= SUGGEST_MIN_LENGTH, {
    message: `Type at least ${SUGGEST_MIN_LENGTH} characters.`,
  })
  .refine((q) => lengthOf(q) <= SUGGEST_MAX_LENGTH, {
    message: `Search text can be at most ${SUGGEST_MAX_LENGTH} characters.`,
  });
const cityParam = z.string().trim().min(1).max(100);

/** D-018: strict. `city` is the user's city, used for "Near you" on an empty query. */
export const SuggestParamsSchema = z.strictObject({
  q: queryText.optional(),
  city: cityParam.optional(),
});
export type SuggestParams = z.infer<typeof SuggestParamsSchema>;

/** D-048: the full results page. `city` and `artist` are explicit filters. */
export const SearchPageParamsSchema = z
  .strictObject({
    q: queryText.optional(),
    city: cityParam.optional(),
    artist: z.string().trim().min(1).max(200).optional(),
    from: dateOrDateTime.optional(),
    to: dateOrDateTime.optional(),
    type: z.enum(EVENT_TYPES).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  })
  .refine((p) => Boolean(p.q || p.city || p.artist || p.from || p.to || p.type), {
    message: "Give a search text or at least one filter.",
    path: ["q"],
  });
export type SearchPageParams = z.infer<typeof SearchPageParamsSchema>;

// ── Output ────────────────────────────────────────────────────────────────

export type SearchGroups = {
  results: Suggestion[];
  artists: ArtistEntity[];
  cities: CityEntity[];
  /** The filters understood from the text and parameters (shown as chips). */
  filters: SearchFilters;
  /** Present when nothing matched: never a dead end (D-047). */
  fallback?: Suggestion[];
  didYouMean?: string;
};

export type SuggestResponse = SearchGroups | { sections: Section<Suggestion>[] };
export type SearchPageResponse = SearchGroups & { total: number; page: number; pageSize: number };

// ── Engine ────────────────────────────────────────────────────────────────

type Window = { offset: number; limit: number; candidates: number };

async function runSearch(
  deps: SearchDeps,
  text: string,
  explicit: SearchFilters,
  window: Window,
): Promise<SearchGroups & { total: number }> {
  const now = deps.clock.now();
  const query = buildSearchQuery(text, now, explicit);
  const plan = planSearch(query);
  // Only punctuation ("%%") and no filters: nothing to look for.
  const nothing = !plan.hasText && Object.keys(query.filters).length === 0;
  const found = nothing
    ? { events: [], artists: [], cities: [] }
    : await deps.search.findCandidates(plan, now, window.candidates);
  const ranked = rankSuggestions(query, found.events, now);
  const groups: SearchGroups & { total: number } = {
    results: ranked.slice(window.offset, window.offset + window.limit),
    artists: rankArtists(query, found.artists),
    cities: rankCities(query, found.cities),
    filters: query.filters,
    total: ranked.length,
  };
  if (ranked.length > 0) return groups;
  const hint = didYouMean(query, found.events, found.artists);
  return {
    ...groups,
    fallback: await fallback(deps, query.filters, now),
    ...(hint === undefined ? {} : { didYouMean: hint }),
  };
}

/** Soonest/trending events in the same city and dates; if none, anywhere. */
async function fallback(deps: SearchDeps, f: SearchFilters, now: Date): Promise<Suggestion[]> {
  const scoped = { city: f.city ?? null, from: f.from ?? null, to: f.to ?? null };
  let found: EventResult[] = await deps.search.findFallback(scoped, now, FALLBACK_SIZE);
  if (found.length === 0 && (scoped.city || scoped.from || scoped.to)) {
    found = await deps.search.findFallback(
      { city: null, from: null, to: null },
      now,
      FALLBACK_SIZE,
    );
  }
  return found.map(asListing);
}

/** Type-ahead. An empty query returns recommendation sections. Never logged (D-048). */
export async function suggest(deps: SearchDeps, params: SuggestParams): Promise<SuggestResponse> {
  const q = params.q ?? "";
  if (q === "") return { sections: await recommendations(deps, params.city) };
  const { total: _total, ...groups } = await runSearch(
    deps,
    q,
    {},
    {
      offset: 0,
      limit: SUGGEST_LIMIT,
      candidates: SUGGEST_CANDIDATES,
    },
  );
  return groups;
}

async function recommendations(deps: SearchDeps, city: string | undefined) {
  const now = deps.clock.now();
  const nearCity = city === undefined ? null : canonicalCity(city);
  const lists = await deps.search.findRecommendations({
    now,
    weekend: weekendWindow(now),
    city: nearCity,
    perSection: SECTION_SIZE * 4, // headroom for de-duplication across sections
    popularSince: new Date(now.getTime() - POPULAR_WINDOW_MS),
  });
  // "For you" needs the user's top/followed artists (D-030), which aren't stored yet.
  return buildSections({
    trending: lists.trending.map(asListing),
    thisWeekend: lists.thisWeekend.map(asListing),
    ...(nearCity ? { nearYou: { city: nearCity, items: lists.nearYou.map(asListing) } } : {}),
    upNext: lists.upNext.map(asListing),
    popularSearches: lists.popularSearches,
  });
}

/** Full results page. Page 1 of a text search is a committed query and is logged (D-047 §6). */
export async function searchPage(
  deps: SearchDeps,
  params: SearchPageParams,
): Promise<SearchPageResponse> {
  const explicit: SearchFilters = {
    ...(params.city ? { city: canonicalCity(params.city) } : {}),
    ...(params.artist ? { artist: params.artist } : {}),
    ...(params.from ? { from: new Date(params.from) } : {}),
    ...(params.to ? { to: endOfDayIfDate(params.to) } : {}),
    ...(params.type ? { type: params.type } : {}),
  };
  const groups = await runSearch(deps, params.q ?? "", explicit, {
    offset: (params.page - 1) * params.pageSize,
    limit: params.pageSize,
    candidates: PAGE_CANDIDATES,
  });
  if (params.q && params.page === 1) await logSearch(deps, params.q, groups.total);
  return { ...groups, page: params.page, pageSize: params.pageSize };
}

/** Analytics must never break search: a failed insert is logged and dropped. */
async function logSearch(deps: SearchDeps, q: string, resultsCount: number): Promise<void> {
  try {
    await deps.searchLog.recordSearch(foldText(q), resultsCount, deps.clock.now());
  } catch (e) {
    deps.logger.warn({ err: e }, "search: failed to log query");
  }
}

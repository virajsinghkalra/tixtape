/**
 * The search contracts (D-042, D-047).
 * Typed:  GET /api/events/suggest?q=&city= → SuggestResponse
 * Empty:  GET /api/events/suggest?q=       → { sections: RecommendationSection[] }
 */
export const MATCH_REASONS = ["title", "alias", "artist", "venue", "city", "fuzzy"] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export type EventResult = {
  id: string;
  title: string;
  type: string;
  /** ISO instant. */
  startsAt: string;
  startsAtDateOnly: boolean;
  city: string | null;
  venueName: string | null;
  matchReason: MatchReason;
  /** The part of the title (or artist name) that matched, for highlighting. */
  matchedText: string;
  matchedArtist?: string;
};

/** Kept for readability where a single row is meant. */
export type Suggestion = EventResult;

export type ArtistEntity = {
  name: string;
  spotifyId?: string;
  imageUrl?: string;
  upcomingCount: number;
  matchedText: string;
  /** The single upcoming show, when there's exactly one (QA-F-1). */
  onlyEventId?: string;
};

export type CityEntity = { city: string; upcomingCount: number };

export type SearchFilters = {
  city?: string;
  from?: string;
  to?: string;
  type?: string;
  genre?: string;
};

export type SuggestResponse = {
  results: EventResult[];
  artists: ArtistEntity[];
  cities: CityEntity[];
  filters: SearchFilters;
  fallback: EventResult[];
  didYouMean?: string;
};

export const SECTION_IDS = [
  "trending",
  "this_weekend",
  "near_you",
  "for_you",
  "popular_searches",
  "up_next",
] as const;
export type RecommendationSection = {
  id: (typeof SECTION_IDS)[number];
  title: string;
  items?: EventResult[];
  queries?: string[];
};

/** What the typed search needs: an already-normalized query plus an optional city filter. */
export type SearchRequest = { query: string; city?: string };

/** Fetches suggestions. Throws `SearchHttpError` on non-2xx. */
export type SearchSource = (
  request: SearchRequest,
  signal: AbortSignal,
) => Promise<SuggestResponse>;

export class SearchHttpError extends Error {
  constructor(readonly status: number) {
    super(`Search request failed with HTTP ${status}`);
    this.name = "SearchHttpError";
  }
}

export const EMPTY_RESPONSE: SuggestResponse = {
  results: [],
  artists: [],
  cities: [],
  filters: {},
  fallback: [],
};

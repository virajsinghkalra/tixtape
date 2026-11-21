/**
 * Search lookups (D-042, D-047, D-048). Implemented by src/infrastructure/db/event-search.ts.
 * Each method is one database round trip.
 */
import type { DateWindow } from "@/domain/events/ist-calendar";
import type {
  ArtistCandidate,
  CityCandidate,
  EventResult,
  SearchPlan,
  SuggestionCandidate,
} from "@/domain/events/search";

export type SearchCandidates = {
  /** Upcoming events inside the plan's filters that may match its text; at most `limit`. */
  events: SuggestionCandidate[];
  /** Artists matching the text (or the artist filter), with upcoming shows inside the filters. */
  artists: ArtistCandidate[];
  /** The filter city and cities starting with the text, with upcoming counts. */
  cities: CityCandidate[];
};

export type Recommendations = {
  /** Events with engagement (decayed trend > 0), highest first, then soonest. */
  trending: EventResult[];
  /** Soonest upcoming events. */
  upNext: EventResult[];
  thisWeekend: EventResult[];
  /** Empty when no city was given. */
  nearYou: EventResult[];
  /** Most-clicked, then most-searched normalized queries with results. */
  popularSearches: string[];
};

export interface EventSearch {
  findCandidates(plan: SearchPlan, now: Date, limit: number): Promise<SearchCandidates>;
  /** Upcoming events inside these filters, trend then date: what to show when nothing matched. */
  findFallback(
    filters: { city: string | null; from: Date | null; to: Date | null },
    now: Date,
    limit: number,
  ): Promise<EventResult[]>;
  findRecommendations(input: {
    now: Date;
    weekend: DateWindow;
    city: string | null;
    perSection: number;
    popularSince: Date;
  }): Promise<Recommendations>;
}

/**
 * Popularity signals and the anonymous search log (D-047 §4, §6). No user ids, no IPs.
 * Implemented in src/infrastructure/db/{event-stats,search-log}-repository.ts.
 */

/**
 * QA-F-7: `event_stats` is derived from the anonymous D-090 analytics (`event_open`, search
 * click-throughs, playlist opens), so no separate client call feeds it.
 */
export interface EventStatsRollup {
  /** Recomputes counters and decayed trend scores for published events. Idempotent. */
  rollup(now: Date): Promise<{ events: number }>;
}

export interface SearchLog {
  /** A committed search (Enter / full results page), not every keystroke (D-048). */
  recordSearch(queryNormalized: string, resultsCount: number, at: Date): Promise<void>;
  /** For the admin list: queries that found nothing, most frequent first. */
  listZeroResultQueries(since: Date, limit: number): Promise<{ query: string; count: number }[]>;
  /** The sweep deletes logs older than 90 days. Returns how many rows went. */
  deleteOlderThan(before: Date): Promise<number>;
}

/** `take` resolves false when the key is over its budget. Postgres in production (D-070). */
export interface RateLimiter {
  take(key: string, now: Date): Promise<boolean>;
}

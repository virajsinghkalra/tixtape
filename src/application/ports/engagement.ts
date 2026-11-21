/**
 * Popularity signals and the anonymous search log (D-047 §4, §6). No user ids, no IPs.
 * Implemented in src/infrastructure/db/{event-stats,search-log}-repository.ts.
 */
import type { EngagementKind } from "@/domain/events/trend";
import type { EventId } from "@/domain/shared/ids";

export interface EventEngagement {
  /** True only for an existing, published event (D-056). */
  isPublished(eventId: EventId): Promise<boolean>;
  /**
   * Bumps the counters and the decayed trend score. Throws `NotFoundError` when the event is
   * missing or not published: the two must look the same from outside (D-056, QA-E-5/6).
   */
  record(eventId: EventId, kind: EngagementKind, at: Date): Promise<void>;
}

export interface SearchLog {
  /** A committed search (Enter / full results page), not every keystroke (D-048). */
  recordSearch(queryNormalized: string, resultsCount: number, at: Date): Promise<void>;
  /** Marks the latest matching search as clicked, or logs a clicked search. */
  recordClick(queryNormalized: string, eventId: EventId, at: Date): Promise<void>;
  /** For the admin list: queries that found nothing, most frequent first. */
  listZeroResultQueries(since: Date, limit: number): Promise<{ query: string; count: number }[]>;
  /** The sweep deletes logs older than 90 days. Returns how many rows went. */
  deleteOlderThan(before: Date): Promise<number>;
}

/** `take` resolves false when the key is over its budget. Postgres in production (D-070). */
export interface RateLimiter {
  take(key: string, now: Date): Promise<boolean>;
}

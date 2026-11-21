/**
 * Ports for the automatic event collector (P1.11) and live lookup (D-050).
 * Adapters in src/infrastructure/sources/ implement `CandidateSource`.
 */
import type {
  CollectorSource,
  EventCandidate,
  ValidatedCandidate,
} from "@/domain/events/extract/candidate";
import type { HeadlinerIdentity, Verification } from "@/domain/events/extract/verify";
import type { EventId } from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";

export type CollectOptions = {
  now: Date;
  /** Watch-list terms (D-050): queries people searched for that found nothing. */
  watchTerms?: readonly string[];
  /** Titles of stored events still missing a confirmed lineup; sources may look for them first. */
  focus?: readonly string[];
};

/**
 * A source of event candidates. Unlike `SourceAdapter`, its items are not publishable on
 * their own: the collector validates artists and corroborates across sources first.
 * Malformed items are skipped (and logged); an upstream failure throws `UpstreamError`.
 */
export interface CandidateSource {
  readonly source: CollectorSource;
  collect(opts: CollectOptions): AsyncIterable<EventCandidate>;
}

/** One Spotify verdict per normalized name: the confirmed display name, or null for "not an artist". */
export type CachedValidation = {
  confirmed: string | null;
  /** The confirmed artist's Spotify ID (absent in entries written before it was kept). */
  spotifyId?: string | null;
  checkedAt: Date;
};

export interface ArtistValidationCache {
  get(normalizedName: string): Promise<CachedValidation | undefined>;
  set(normalizedName: string, value: CachedValidation): Promise<void>;
}

/** Per-process memory cache; the script uses a file-backed one. */
export function createMemoryValidationCache(): ArtistValidationCache {
  const map = new Map<string, CachedValidation>();
  return {
    get: async (key) => map.get(key),
    set: async (key, value) => {
      map.set(key, value);
    },
  };
}

/** A candidate as remembered between runs (`event_candidates`), for cross-run corroboration. */
export type StoredCandidate = {
  candidate: ValidatedCandidate;
  /** Set once the candidate's cluster was published. */
  publishedEventId: EventId | null;
  lastSeenAt: Date;
};

export interface CandidateStore {
  /** Upsert on (source, externalId); refreshes the facts and `lastSeenAt`. */
  upsert(candidate: ValidatedCandidate, dedupeKey: string, seenAt: Date): Promise<void>;
  /** Candidates whose event starts at or after `from`, seen since `seenSince`. */
  listUpcoming(from: Date, seenSince: Date): Promise<StoredCandidate[]>;
  markPublished(source: EventSource, externalId: string, eventId: EventId): Promise<void>;
  /** D-060: deletes candidates not seen since `before`. Returns how many. */
  deleteStale(before: Date): Promise<number>;
}

/** In-memory store for tests and one-off runs. */
export function createMemoryCandidateStore(): CandidateStore & { rows: StoredCandidate[] } {
  const rows: StoredCandidate[] = [];
  const find = (source: string, externalId: string) =>
    rows.find((r) => r.candidate.source === source && r.candidate.externalId === externalId);
  return {
    rows,
    async upsert(candidate, _key, seenAt) {
      const existing = find(candidate.source, candidate.externalId);
      if (existing) Object.assign(existing, { candidate, lastSeenAt: seenAt });
      else rows.push({ candidate, publishedEventId: null, lastSeenAt: seenAt });
    },
    async listUpcoming(from, seenSince) {
      return rows.filter(
        (r) =>
          (r.candidate.endsAt ?? r.candidate.startsAt).getTime() >= from.getTime() &&
          r.lastSeenAt.getTime() >= seenSince.getTime(),
      );
    },
    async markPublished(source, externalId, eventId) {
      const row = find(source, externalId);
      if (row) row.publishedEventId = eventId;
    },
    async deleteStale(before) {
      const keep = rows.filter((r) => r.lastSeenAt.getTime() >= before.getTime());
      const removed = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return removed;
    },
  };
}

export type EventVisibility = "held" | "published" | "archived";

/** D-056: verification results, visibility and re-verification on stored events. */
export interface EventVerificationStore {
  save(eventId: EventId, verification: Verification, checkedAt: Date): Promise<void>;
  get(eventId: EventId): Promise<{
    title: string;
    visibility: EventVisibility;
    startsAt: Date;
    endsAt: Date | null;
    verification: Verification | null;
    lastVerifiedAt: Date | null;
  } | null>;
  /** Titles of upcoming held or published events whose lineup isn't confirmed yet. */
  listMissingLineups(now: Date): Promise<string[]>;
  setVisibility(eventId: EventId, visibility: EventVisibility): Promise<void>;
  /** Published or held events whose date has passed become `archived`. Returns how many. */
  archivePast(now: Date): Promise<number>;
  /** Artist lineups of past events in the same series (dedupe-key title part). */
  pastLineups(seriesKey: string, before: Date): Promise<string[][]>;
}

/** Wikidata/MusicBrainz identity for a Spotify artist (D-051, D-056 layer 3). */
export interface ArtistIdentityLookup {
  lookup(spotifyId: string): Promise<HeadlinerIdentity | null>;
}

/** Nominatim geocoding (D-051): the city a venue lies in, or null when not found. */
export interface VenueGeocoder {
  cityOf(venue: string, city: string): Promise<string | null>;
}

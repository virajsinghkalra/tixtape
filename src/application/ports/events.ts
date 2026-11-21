/**
 * Event persistence (P1.5–P1.7). Implemented in src/infrastructure/db/event-repository.ts.
 * Consumers: ingest and admin use cases (writes), public/admin read routes, Playlist Engine (reads).
 */
import type { DedupeSubject } from "@/domain/events/dedupe";
import type { EventVisibility } from "@/domain/events/visibility";
import type { ArtistId, EventId, SpotifyArtistId, VenueId } from "@/domain/shared/ids";
import type {
  BillingTier,
  EventSource,
  EventStatus,
  EventType,
  MatchStatus,
} from "@/domain/shared/lineup";

/** The event columns a source can set. Merged field by field by source precedence. */
export type EventFields = {
  title: string;
  type: EventType;
  status: EventStatus;
  startsAt: Date;
  /** D-034: only a date is known; the UI shows "time TBA". Travels with `startsAt`. */
  startsAtDateOnly: boolean;
  endsAt: Date | null;
  genre: string | null;
  imageUrl: string | null;
  venueId: VenueId | null;
};

export type EventRecord = EventFields & {
  id: EventId;
  dedupeKey: string;
  lineupHash: string | null;
  /** Every source that has contributed to this event. */
  sources: EventSource[];
};

export type DedupeCandidate = DedupeSubject & { id: EventId };

export type LineupRow = {
  artistId: ArtistId;
  billingRank: number;
  tier: BillingTier;
  day: number | null;
  stage: string | null;
};

export type EventSourceRef = {
  source: EventSource;
  /** Null for admin entry: the event's own ID is used. */
  externalId: string | null;
  url: string | null;
  raw: unknown;
  seenAt: Date;
};

/** One atomic write: event row, its source row and (optionally) its whole lineup. */
export type EventWrite = {
  /** Null creates a new event. */
  id: EventId | null;
  fields: EventFields;
  dedupeKey: string;
  source: EventSourceRef;
  /** Null leaves the stored lineup untouched. */
  lineup: { rows: LineupRow[]; hash: string } | null;
  /** D-056: set only by an explicit admin choice. Omitted: new events start `held`. */
  visibility?: EventVisibility;
};

export type VenueSummary = { id: VenueId; name: string; city: string; country: string };

export type EventSummary = {
  id: EventId;
  title: string;
  type: EventType;
  status: EventStatus;
  startsAt: Date;
  endsAt: Date | null;
  genre: string | null;
  imageUrl: string | null;
  /** D-082: the official page's og:image (hotlinked), when we have one. */
  posterUrl?: string | null;
  /** Attribution for the poster when its source needs one (migration 0014). */
  posterCredit?: string | null;
  venue: VenueSummary | null;
  artistCount: number;
};

export type LineupArtist = {
  artistId: ArtistId;
  name: string;
  billingRank: number;
  tier: BillingTier;
  day: number | null;
  stage: string | null;
  matchStatus: MatchStatus;
  spotifyId: SpotifyArtistId | null;
  imageUrl: string | null;
  /** D-083: an alternate (e.g. Wikimedia Commons) photo and its attribution. */
  altImageUrl?: string | null;
  altImageCredit?: string | null;
};

export type EventDetail = EventSummary & {
  lineupHash: string | null;
  lineup: LineupArtist[];
  sources: { source: EventSource; externalId: string; url: string | null; lastSeenAt: Date }[];
  createdAt: Date;
  updatedAt: Date;
};

/** D-056 verification state: admin reads only. */
export type EventAdminFields = {
  visibility: EventVisibility;
  confidence: number;
  lastVerifiedAt: Date | null;
};
export type AdminEventSummary = EventSummary & EventAdminFields;
export type AdminEventDetail = EventDetail & EventAdminFields;

export type EventListFilter = {
  /** Null lists every visibility (admin). Public reads pass `published` (D-056). */
  visibility: EventVisibility | null;
  /** Canonical city name (`canonicalCity`). */
  city?: string;
  from?: Date;
  to?: Date;
  /** Case-insensitive substring of the title. */
  q?: string;
  type?: EventType;
  limit: number;
  offset: number;
};

export interface EventRepository {
  findIdBySourceRef(source: EventSource, externalId: string): Promise<EventId | null>;
  findIdByDedupeKey(dedupeKey: string): Promise<EventId | null>;
  findById(id: EventId): Promise<EventRecord | null>;
  /** Events whose venue is in this city/country and that start inside [from, to]. */
  listDedupeCandidates(block: {
    country: string;
    city: string;
    from: Date;
    to: Date;
  }): Promise<DedupeCandidate[]>;
  /**
   * Creates or updates the event, upserts its source row and replaces the lineup, in one
   * transaction. Throws `ConflictError` when the dedupe key belongs to another event.
   */
  save(write: EventWrite): Promise<EventId>;
  /** Changes only `visibility` (no source row, no ownership change). False if no such event. */
  setVisibility(id: EventId, visibility: EventVisibility): Promise<boolean>;
  /** Any visibility; callers decide what to show (D-056). */
  getDetail(id: EventId): Promise<AdminEventDetail | null>;
  /** Ordered by start time, then ID. */
  list(filter: EventListFilter): Promise<{ items: AdminEventSummary[]; total: number }>;
}

/** What `EventMerge.mergeEvents` did, or why it refused. */
export type EventMergeOutcome =
  | {
      kind: "merged";
      /** True when the duplicate's sources outranked the canonical's, so its fields and lineup won (D-026). */
      duplicateFieldsWon: boolean;
      sourcesMoved: number;
      sharedPlaylistMoved: boolean;
      personalPlaylistsMoved: number;
    }
  | { kind: "not_found"; missing: EventId[] }
  /** Both events already have a public playlist; an admin must pick one. Nothing changed. */
  | { kind: "both_have_shared_playlist" }
  /** Both events have an active shared playlist build (D-036). Retry when one finishes. */
  | { kind: "both_have_active_shared_job" }
  /** A user has a personal playlist with the same options on both events. */
  | { kind: "personal_playlist_conflict"; userIds: string[] };

/** Possible duplicate events (D-028) and merging them (P1.10). Implemented by `PgEventRepository`. */
export interface EventMerge {
  /** Upserts a review row for a dedupe score between the review and merge thresholds. Idempotent. */
  recordMergeReview(eventId: EventId, similarTo: EventId, score: number): Promise<void>;
  listMergeReviews(
    limit: number,
  ): Promise<{ eventId: EventId; similarTo: EventId; score: number; createdAt: Date }[]>;
  /**
   * One transaction: moves sources, lineup (by source precedence, D-026), shared and personal
   * playlists, jobs, stats and review rows to the canonical event, then deletes the duplicate.
   * The canonical event keeps its own visibility. Refuses (changing nothing) on the conflicts in
   * `EventMergeOutcome`. Throws `ValidationError` when both IDs are the same.
   */
  mergeEvents(duplicateId: EventId, canonicalId: EventId): Promise<EventMergeOutcome>;
}

/**
 * Artist Matching module (P1.8, P1.9, D-066). The Lead wires `createMatchingModule` into the
 * container (D-014); routes and jobs call the returned use cases.
 */
import type { Artist, ArtistMerge, ArtistRepository } from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type { ArtistCatalog, TrackCatalog } from "@/application/ports/spotify";
import type { WebSearch } from "@/application/ports/web-search";
import type { MatchPolicy } from "@/domain/matching/decide";
import type { ArtistId, EventId, SpotifyArtistId } from "@/domain/shared/ids";
import type { Result } from "@/lib/result";
import { createInMemoryCandidateStore, type MatchCandidateStore } from "./candidate-store";
import type { ArtistRelations } from "./gather-evidence";
import {
  resolveArtist,
  resolvePendingArtists,
  type ResolveBatchReport,
  type ResolveContext,
  type ResolveOutcome,
} from "./resolve-artist";
import { resolveEventLineup, type EventLineupReader } from "./resolve-event";
import { createInMemoryWebEvidenceCache, type WebEvidenceCache } from "./web-evidence-cache";
import {
  approveMatch,
  listReviewQueue,
  markNotFound,
  type ReviewError,
  type ReviewItem,
} from "./review";

export type { MatchCandidateStore } from "./candidate-store";
export type { ArtistRelations, EventContext } from "./gather-evidence";
export type { ResolveBatchReport, ResolveContext, ResolveOutcome } from "./resolve-artist";
export type { EventLineup, EventLineupReader } from "./resolve-event";
export type { WebEvidenceCache } from "./web-evidence-cache";
export type { ReviewError, ReviewItem } from "./review";

export type MatchingDeps = {
  catalog: ArtistCatalog;
  /** D-041: one track search per near-tie, to see who owns the songs. */
  tracks: TrackCatalog;
  /** D-025: `PgArtistRepository` implements both. */
  artists: ArtistRepository & ArtistMerge;
  clock: Clock;
  /** Defaults to an in-memory store (no table for candidates yet). */
  candidateStore?: MatchCandidateStore;
  /** D-066: web corroboration (Tavily). Without it, hard cases stay in review. */
  web?: WebSearch;
  /** D-066: 30-day cache of web results. Defaults to in memory. */
  webCache?: WebEvidenceCache;
  /** D-066: web searches allowed per run (default 20). */
  webSearchesPerRun?: number;
  /** D-066: band ↔ member links (MusicBrainz), when an adapter exists. */
  relations?: ArtistRelations;
  /** D-066: the event lineup read side, for `resolveEventLineup`. */
  eventLineups?: EventLineupReader;
  policy?: MatchPolicy;
};

export type MatchingModule = {
  resolveArtist(artist: Artist, context?: ResolveContext): Promise<ResolveOutcome>;
  resolvePendingArtists(limit: number): Promise<ResolveBatchReport>;
  /** D-066: re-resolve an event's unconfirmed artists with the event as context. */
  resolveEventLineup(eventId: EventId): Promise<Result<ResolveBatchReport, "event_not_found">>;
  listReviewQueue(limit: number): Promise<ReviewItem[]>;
  approveMatch(
    artistId: ArtistId,
    spotifyArtistId: SpotifyArtistId,
  ): Promise<Result<{ artistId: ArtistId; spotifyId: SpotifyArtistId }, ReviewError>>;
  markNotFound(artistId: ArtistId): Promise<Result<{ artistId: ArtistId }, ReviewError>>;
};

export function createMatchingModule(deps: MatchingDeps): MatchingModule {
  const resolved = {
    ...deps,
    candidateStore: deps.candidateStore ?? createInMemoryCandidateStore(),
    webCache: deps.webCache ?? createInMemoryWebEvidenceCache(),
  };
  return {
    resolveArtist: (artist, context) => resolveArtist(resolved, artist, context),
    resolvePendingArtists: (limit) => resolvePendingArtists(resolved, limit),
    resolveEventLineup: async (eventId) => {
      const eventLineups = resolved.eventLineups;
      if (!eventLineups) throw new Error("Matching needs `eventLineups` to resolve an event.");
      return resolveEventLineup({ ...resolved, eventLineups }, eventId);
    },
    listReviewQueue: (limit) => listReviewQueue(resolved, limit),
    approveMatch: (artistId, spotifyArtistId) => approveMatch(resolved, artistId, spotifyArtistId),
    markNotFound: (artistId) => markNotFound(resolved, artistId),
  };
}

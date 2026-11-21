/**
 * Artist repository port. Shared by Events & Ingestion (creates artists from lineups)
 * and Artist Matching (records Spotify matches). Implemented in
 * src/infrastructure/db/artist-repository.ts by the Events team (it owns artist rows);
 * Matching only calls the match-related methods.
 */
import type { ArtistId, SpotifyArtistId } from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";

export type Artist = {
  id: ArtistId;
  name: string;
  normalizedName: string;
  spotifyId: SpotifyArtistId | null;
  matchScore: number | null;
  matchStatus: MatchStatus;
  imageUrl: string | null;
  spotifyResolvedAt: Date | null;
};

export interface ArtistRepository {
  /** Returns the existing artist for this normalized name or alias, or creates a `pending` one. */
  findOrCreateByName(name: string, normalizedName: string): Promise<Artist>;
  findById(id: ArtistId): Promise<Artist | null>;
  findByAlias(normalizedName: string): Promise<Artist | null>;
  /** Artists still `pending`, or resolved before `olderThan` (30-day re-check, D-009). */
  listNeedingResolution(olderThan: Date, limit: number): Promise<Artist[]>;
  listNeedingReview(limit: number): Promise<Artist[]>;
  recordMatch(
    id: ArtistId,
    match: {
      spotifyId: SpotifyArtistId | null;
      score: number | null;
      status: MatchStatus;
      imageUrl: string | null;
      resolvedAt: Date;
    },
  ): Promise<void>;
  addAlias(artistId: ArtistId, aliasNormalized: string): Promise<void>;
}

/** What `ArtistMerge.mergeInto` did, or why it refused (D-025, ENGINEERING.md §10.4). */
export type ArtistMergeOutcome =
  | {
      kind: "merged";
      /** Lineup rows re-pointed to the canonical artist. */
      lineupRowsMoved: number;
      /** Lineup rows dropped because the canonical artist was already on that event. */
      lineupRowsCollapsed: number;
      aliasesMoved: number;
      trackCacheRowsMoved: number;
    }
  | { kind: "not_found"; missing: ArtistId[] }
  /** The two rows are linked to different Spotify artists, or the canonical one is a manual "no match" (D-026): review, don't merge. */
  | {
      kind: "spotify_conflict";
      duplicateSpotifyId: SpotifyArtistId | null;
      canonicalSpotifyId: SpotifyArtistId | null;
    };

/**
 * Merging duplicate artist rows (D-025, P1.10). Kept apart from `ArtistRepository` so fakes of
 * that port don't have to implement it; `PgArtistRepository` implements both.
 */
export interface ArtistMerge {
  findBySpotifyId(spotifyId: SpotifyArtistId): Promise<Artist | null>;
  /**
   * One transaction: moves lineup rows (keeping the higher billing when both artists play the
   * same event), aliases, and, when the canonical row inherits the duplicate's Spotify match,
   * its track cache; adds the duplicate's name as an alias of the canonical artist; deletes the
   * duplicate. Throws `ValidationError` when both IDs are the same.
   */
  mergeInto(duplicateId: ArtistId, canonicalId: ArtistId): Promise<ArtistMergeOutcome>;
}

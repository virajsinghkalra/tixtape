/** Test fakes for the ports Artist Matching uses. They follow the port contracts. */
import type {
  Artist,
  ArtistMerge,
  ArtistMergeOutcome,
  ArtistRepository,
} from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type {
  ArtistCatalog,
  SpotifyArtistCandidate,
  SpotifyAlbum,
  SpotifyBlockedInfo,
  SpotifyTrack,
  TrackCatalog,
} from "@/application/ports/spotify";
import {
  asArtistId,
  asSpotifyArtistId,
  asSpotifyTrackId,
  type ArtistId,
  type SpotifyArtistId,
} from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { ConflictError, ValidationError } from "@/lib/errors";
import type { WebPage, WebSearch } from "@/application/ports/web-search";

export const fixedClock = (iso = "2026-11-21T10:00:00Z"): Clock => ({ now: () => new Date(iso) });

export class InMemoryArtistRepository implements ArtistRepository, ArtistMerge {
  readonly rows = new Map<ArtistId, Artist>();
  readonly aliases = new Map<string, ArtistId>();
  private nextId = 1;

  add(name: string, over: Partial<Artist> = {}): Artist {
    const artist: Artist = {
      id: asArtistId(`artist-${this.nextId++}`),
      name,
      normalizedName: normalizeArtistName(name),
      spotifyId: null,
      matchScore: null,
      matchStatus: "pending",
      imageUrl: null,
      spotifyResolvedAt: null,
      ...over,
    };
    this.rows.set(artist.id, artist);
    return artist;
  }

  async findOrCreateByName(name: string, normalizedName: string): Promise<Artist> {
    const existing =
      (await this.findByAlias(normalizedName)) ??
      [...this.rows.values()].find((a) => a.normalizedName === normalizedName);
    return existing ?? this.add(name, { normalizedName });
  }

  async findById(id: ArtistId): Promise<Artist | null> {
    return this.rows.get(id) ?? null;
  }

  async findByAlias(normalizedName: string): Promise<Artist | null> {
    const id = this.aliases.get(normalizedName);
    return id ? (this.rows.get(id) ?? null) : null;
  }

  async listNeedingResolution(olderThan: Date, limit: number): Promise<Artist[]> {
    return [...this.rows.values()]
      .filter(
        (a) =>
          a.matchStatus === "pending" ||
          (a.spotifyResolvedAt !== null && a.spotifyResolvedAt < olderThan),
      )
      .slice(0, limit);
  }

  async listNeedingReview(limit: number): Promise<Artist[]> {
    return [...this.rows.values()].filter((a) => a.matchStatus === "needs_review").slice(0, limit);
  }

  async recordMatch(id: ArtistId, match: Parameters<ArtistRepository["recordMatch"]>[1]) {
    const artist = this.rows.get(id);
    if (!artist) throw new Error(`no artist ${id}`);
    const holder = [...this.rows.values()].find(
      (a) => a.id !== id && match.spotifyId !== null && a.spotifyId === match.spotifyId,
    );
    // Mirrors the unique index `artists_spotify_id_uq`.
    if (holder) throw new ConflictError(`spotify_id ${match.spotifyId} belongs to ${holder.id}`);
    this.rows.set(id, {
      ...artist,
      spotifyId: match.spotifyId,
      matchScore: match.score,
      matchStatus: match.status,
      imageUrl: match.imageUrl,
      spotifyResolvedAt: match.resolvedAt,
    });
  }

  async addAlias(artistId: ArtistId, aliasNormalized: string): Promise<void> {
    this.aliases.set(aliasNormalized, artistId);
  }

  async findBySpotifyId(spotifyId: SpotifyArtistId): Promise<Artist | null> {
    return [...this.rows.values()].find((a) => a.spotifyId === spotifyId) ?? null;
  }

  /** Follows the D-025 contract: refuses different Spotify IDs or a "no match" canonical row. */
  async mergeInto(duplicateId: ArtistId, canonicalId: ArtistId): Promise<ArtistMergeOutcome> {
    if (duplicateId === canonicalId)
      throw new ValidationError("Can't merge an artist into itself.");
    const dup = this.rows.get(duplicateId);
    const canon = this.rows.get(canonicalId);
    if (!dup || !canon) {
      return {
        kind: "not_found",
        missing: [duplicateId, canonicalId].filter((id) => !this.rows.has(id)),
      };
    }
    const differentIds = dup.spotifyId && canon.spotifyId && dup.spotifyId !== canon.spotifyId;
    if (differentIds || canon.matchStatus === "not_found") {
      return {
        kind: "spotify_conflict",
        duplicateSpotifyId: dup.spotifyId,
        canonicalSpotifyId: canon.spotifyId,
      };
    }
    let aliasesMoved = 0;
    for (const [alias, owner] of this.aliases) {
      if (owner === duplicateId) {
        this.aliases.set(alias, canonicalId);
        aliasesMoved += 1;
      }
    }
    this.aliases.set(dup.normalizedName, canonicalId);
    this.rows.delete(duplicateId);
    this.merges.push({ duplicateId, canonicalId });
    return {
      kind: "merged",
      lineupRowsMoved: 0,
      lineupRowsCollapsed: 0,
      aliasesMoved,
      trackCacheRowsMoved: 0,
    };
  }

  readonly merges: { duplicateId: ArtistId; canonicalId: ArtistId }[] = [];
}

export class SpotifyBlockedFake extends Error implements SpotifyBlockedInfo {
  readonly reason = "long_retry_after" as const;
  constructor(readonly resumeAfter: Date) {
    super("Spotify is blocking calls");
  }
}

/** Answers searches from a table keyed by query; records every query it was asked. */
export class FakeArtistCatalog implements ArtistCatalog {
  readonly queries: string[] = [];
  private failures = new Map<string, unknown>();

  constructor(
    private readonly results: Readonly<
      Partial<Record<string, readonly SpotifyArtistCandidate[]>>
    > = {},
  ) {}

  failOn(query: string, error: unknown): this {
    this.failures.set(query, error);
    return this;
  }

  async searchArtists(query: string): Promise<SpotifyArtistCandidate[]> {
    this.queries.push(query);
    if (this.failures.has(query)) throw this.failures.get(query);
    return [...(this.results[query] ?? [])];
  }
}

export const spotifyArtist = (
  id: string,
  name: string,
  rank: number,
  over: Partial<SpotifyArtistCandidate> = {},
): SpotifyArtistCandidate => ({
  id: asSpotifyArtistId(id),
  name,
  rank,
  imageUrl: `https://i.scdn.co/image/${id}`,
  genres: [],
  ...over,
});

/** Answers track searches from a table keyed by query; records each `(query, market)` call. */
export class FakeTrackCatalog implements TrackCatalog {
  readonly calls: { query: string; market: string }[] = [];
  private failures = new Map<string, unknown>();

  constructor(
    private readonly results: Readonly<Partial<Record<string, readonly SpotifyTrack[]>>> = {},
  ) {}

  failOn(query: string, error: unknown): this {
    this.failures.set(query, error);
    return this;
  }

  async searchTracks(query: string, market: string): Promise<SpotifyTrack[]> {
    this.calls.push({ query, market });
    if (this.failures.has(query)) throw this.failures.get(query);
    return [...(this.results[query] ?? [])];
  }

  /** Albums by artist ID (D-066 activity signal). Unknown artists have none. */
  readonly albums: Record<string, SpotifyAlbum[]> = {};
  readonly albumCalls: string[] = [];

  async getArtistAlbums(artistId: string): Promise<SpotifyAlbum[]> {
    this.albumCalls.push(artistId);
    if (this.failures.has(`albums:${artistId}`)) throw this.failures.get(`albums:${artistId}`);
    return [...(this.albums[artistId] ?? [])];
  }

  async getAlbumTracks(): Promise<never> {
    throw new Error("Artist Matching doesn't read album tracks");
  }
}

/** Tracks credited to the given artists, one track per entry. */
export const tracksBy = (...artistIds: string[][]): SpotifyTrack[] =>
  artistIds.map((ids, i) => ({
    id: asSpotifyTrackId(`t${i}`),
    name: `Track ${i}`,
    artistIds: ids.map(asSpotifyArtistId),
    albumId: `al${i}`,
    albumReleaseDate: null,
    isrc: null,
    durationMs: 200_000,
    rank: i,
  }));

export const album = (year: string): SpotifyAlbum => ({
  id: `al-${year}`,
  name: `Album ${year}`,
  releaseDate: `${year}-01-01`,
  albumType: "album",
});

/** Answers web searches from a table keyed by query; records each query. */
export class FakeWebSearch implements WebSearch {
  readonly queries: string[] = [];
  private failure: unknown = null;

  constructor(
    private readonly results: Readonly<Partial<Record<string, readonly WebPage[]>>> = {},
  ) {}

  failWith(error: unknown): this {
    this.failure = error;
    return this;
  }

  async search(query: string): Promise<WebPage[]> {
    this.queries.push(query);
    if (this.failure) throw this.failure;
    return [...(this.results[query] ?? [])];
  }
}

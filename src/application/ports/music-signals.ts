/**
 * Popularity signals for song picking (D-038). Implemented in src/infrastructure/music-signals/.
 * Adapters validate responses, pace their calls and cache per artist for 24 hours.
 * Last.fm and Apple failures throw `UpstreamError`; the engine treats them as "no signal".
 */
import type { SpotifyArtistId } from "@/domain/shared/ids";
import type { SpotifyTrack } from "./spotify";

export type MostListenedTrack = { title: string; playcount: number; listeners: number };

/** Most-listened songs for an artist, most played first (Last.fm `artist.getTopTracks`). */
export interface MostListenedSource {
  /** Empty when the service doesn't know the artist. */
  topTracks(artistName: string, mbid?: string): Promise<MostListenedTrack[]>;
}

export type ChartEntry = { title: string; artistName: string; rank: number };

/** A market-wide daily chart, best first (Apple Music "most played", D-038). */
export interface TrendingSource {
  /** `market` is an ISO 3166-1 alpha-2 code, e.g. "IN". */
  chart(market: string): Promise<ChartEntry[]>;
}

/** An artist's newest releases (albums and singles), newest first, as Spotify tracks. */
export interface NewReleaseSource {
  /** Throws the Spotify errors of `TrackCatalog` (`SpotifyBlockedError`, …). */
  newestTracks(artistId: SpotifyArtistId, market: string, limit: number): Promise<SpotifyTrack[]>;
}

/** Real-world popularity for weighting an artist's share of the playlist (D-065). */
export interface ArtistPopularitySource {
  /**
   * Last.fm listeners, or null when unknown. `cachedOnly` answers from the cache without a
   * request (for quick previews). Failures throw `UpstreamError`; callers treat them as null.
   */
  listeners(
    artistName: string,
    opts?: { mbid?: string; cachedOnly?: boolean },
  ): Promise<number | null>;
}

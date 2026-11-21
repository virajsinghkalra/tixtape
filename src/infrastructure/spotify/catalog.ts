/**
 * Read-only Spotify catalog calls (P1.3, D-007, LLD §7.2). Rank is the position in Spotify's
 * results: the only popularity proxy left for new apps.
 */
import type { z } from "zod";
import type {
  ArtistCatalog,
  SpotifyAlbum,
  SpotifyArtistCandidate,
  SpotifyCaller,
  SpotifyTrack,
  TrackCatalog,
} from "@/application/ports/spotify";
import { asSpotifyArtistId, asSpotifyTrackId, type SpotifyArtistId } from "@/domain/shared/ids";
import { ValidationError } from "@/lib/errors";
import {
  SPOTIFY_ID,
  albumTracksSchema,
  artistAlbumsSchema,
  artistSearchSchema,
  trackSearchSchema,
} from "./schemas";
import type { simplifiedTrackSchema, trackSchema } from "./schemas";
import type { SpotifyHttp } from "./spotify-http";

/** D-007: search and artist albums are capped at 10 for new apps. */
export const SEARCH_LIMIT = 10;
export const ALBUMS_LIMIT = 10;
const ALBUM_TRACKS_LIMIT = 50;
const MAX_QUERY_LENGTH = 250;
const MARKET = /^[A-Z]{2}$/;
const ALBUM_TYPES = new Set<SpotifyAlbum["albumType"]>([
  "album",
  "single",
  "compilation",
  "appears_on",
]);

export class SpotifyArtistCatalog implements ArtistCatalog {
  constructor(private readonly http: SpotifyHttp) {}

  async searchArtists(
    query: string,
    caller: SpotifyCaller,
    opts?: { offset?: number },
  ): Promise<SpotifyArtistCandidate[]> {
    const offset = opts?.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) {
      throw new ValidationError("Search offset must be an integer from 0 to 1000.");
    }
    const body = await this.http.request({
      method: "GET",
      path: "/search",
      query: { q: checkQuery(query), type: "artist", limit: SEARCH_LIMIT, offset },
      auth: caller,
      schema: artistSearchSchema,
    });
    return compact(body.artists.items).map((a, i) => ({
      id: asSpotifyArtistId(a.id),
      name: a.name,
      rank: offset + i,
      imageUrl: a.images?.[0]?.url ?? null,
      genres: a.genres ?? [],
    }));
  }
}

export class SpotifyTrackCatalog implements TrackCatalog {
  constructor(private readonly http: SpotifyHttp) {}

  async searchTracks(
    query: string,
    market: string,
    caller: SpotifyCaller,
  ): Promise<SpotifyTrack[]> {
    const body = await this.http.request({
      method: "GET",
      path: "/search",
      query: {
        q: checkQuery(query),
        type: "track",
        limit: SEARCH_LIMIT,
        market: checkMarket(market),
      },
      auth: caller,
      schema: trackSearchSchema,
    });
    return withIds(compact(body.tracks.items)).map((t, rank) =>
      toTrack(t, t.album.id, t.album.release_date ?? null, t.external_ids?.isrc ?? null, rank),
    );
  }

  async getArtistAlbums(
    artistId: SpotifyArtistId,
    market: string,
    caller: SpotifyCaller,
  ): Promise<SpotifyAlbum[]> {
    const body = await this.http.request({
      method: "GET",
      path: `/artists/${checkId(artistId, "artist")}/albums`,
      query: {
        include_groups: "album,single",
        limit: ALBUMS_LIMIT,
        market: checkMarket(market),
      },
      auth: caller,
      schema: artistAlbumsSchema,
    });
    return compact(body.items).flatMap((a) => {
      const albumType = (a.album_group ?? a.album_type) as SpotifyAlbum["albumType"];
      if (!ALBUM_TYPES.has(albumType)) return [];
      return [{ id: a.id, name: a.name, releaseDate: a.release_date ?? null, albumType }];
    });
  }

  /** The first 50 tracks. Simplified tracks carry no release date or ISRC, so those are null. */
  async getAlbumTracks(
    albumId: string,
    market: string,
    caller: SpotifyCaller,
  ): Promise<SpotifyTrack[]> {
    const id = checkId(albumId, "album");
    const body = await this.http.request({
      method: "GET",
      path: `/albums/${id}/tracks`,
      query: { limit: ALBUM_TRACKS_LIMIT, market: checkMarket(market) },
      auth: caller,
      schema: albumTracksSchema,
    });
    return withIds(compact(body.items)).map((t, rank) => toTrack(t, id, null, null, rank));
  }
}

type RawTrack = z.infer<typeof simplifiedTrackSchema> | z.infer<typeof trackSchema>;

function toTrack(
  t: RawTrack & { id: string },
  albumId: string,
  albumReleaseDate: string | null,
  isrc: string | null,
  rank: number,
): SpotifyTrack {
  return {
    id: asSpotifyTrackId(t.id),
    name: t.name,
    artistIds: t.artists.flatMap((a) => (a.id ? [asSpotifyArtistId(a.id)] : [])),
    albumId,
    albumReleaseDate,
    isrc,
    durationMs: t.duration_ms,
    rank,
  };
}

const compact = <T>(items: Array<T | null>): T[] => items.filter((x): x is T => x !== null);

/** Local files and unavailable tracks come back with `id: null`; they can't be added. */
const withIds = <T extends { id: string | null }>(items: T[]) =>
  items.filter((t): t is T & { id: string } => t.id !== null);

export function checkId(id: string, what: string): string {
  if (!SPOTIFY_ID.test(id)) throw new ValidationError(`Invalid Spotify ${what} id.`);
  return id;
}

function checkQuery(query: string): string {
  const q = query.trim();
  if (q === "" || q.length > MAX_QUERY_LENGTH) {
    throw new ValidationError(`Search text must be 1 to ${MAX_QUERY_LENGTH} characters.`);
  }
  return q;
}

/** D-007: market is always explicit (ISO 3166-1 alpha-2). */
function checkMarket(market: string): string {
  if (!MARKET.test(market)) throw new ValidationError("Market must be a two-letter country code.");
  return market;
}

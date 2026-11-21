/**
 * Newest releases from Spotify (D-038): `GET /artists/{id}/albums` (album, single), newest
 * first, then the tracks of the newest few releases. Cached per artist for 24 hours.
 * The iTunes fallback from D-038 isn't implemented: it needs an iTunes artist id we don't store.
 */
import type { Clock } from "@/application/ports/clock";
import type { NewReleaseSource } from "@/application/ports/music-signals";
import type { SpotifyAlbum, SpotifyTrack, TrackCatalog } from "@/application/ports/spotify";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { TtlCache } from "./ttl-cache";

/** Releases opened at most per artist: each costs one Spotify call. */
const MAX_RELEASES = 2;
const APP = { kind: "app" } as const;

const byNewest = (a: SpotifyAlbum, b: SpotifyAlbum) =>
  (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");

export class SpotifyNewReleases implements NewReleaseSource {
  private readonly cache: TtlCache<SpotifyTrack[]>;

  constructor(
    private readonly catalog: TrackCatalog,
    clock: Clock,
  ) {
    this.cache = new TtlCache(clock);
  }

  newestTracks(artistId: SpotifyArtistId, market: string, limit: number): Promise<SpotifyTrack[]> {
    return this.cache.getOrLoad(`${artistId}|${market}|${limit}`, () =>
      this.load(artistId, market, limit),
    );
  }

  private async load(
    artistId: SpotifyArtistId,
    market: string,
    limit: number,
  ): Promise<SpotifyTrack[]> {
    const albums = (await this.catalog.getArtistAlbums(artistId, market, APP))
      .filter((a) => a.albumType === "album" || a.albumType === "single")
      .sort(byNewest)
      .slice(0, MAX_RELEASES);
    const out: SpotifyTrack[] = [];
    for (const album of albums) {
      if (out.length >= limit) break;
      const tracks = await this.catalog.getAlbumTracks(album.id, market, APP);
      out.push(...tracks.filter((t) => t.artistIds.includes(artistId)));
    }
    return out.slice(0, limit);
  }
}

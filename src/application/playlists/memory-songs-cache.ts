/** Per-process `ArtistSongsCache` for tests and tools; production uses `artist_track_cache`. */
import type { ArtistSongs, ArtistSongsCache } from "@/application/ports/playlists";
import type { ArtistId } from "@/domain/shared/ids";

export class MemoryArtistSongsCache implements ArtistSongsCache {
  readonly rows = new Map<string, ArtistSongs>();

  async getMany(artistIds: readonly ArtistId[], market: string) {
    const out = new Map<ArtistId, ArtistSongs>();
    for (const id of artistIds) {
      const hit = this.rows.get(`${id}|${market}`);
      if (hit) out.set(id, structuredClone(hit));
    }
    return out;
  }

  async put(artistId: ArtistId, market: string, songs: ArtistSongs) {
    this.rows.set(`${artistId}|${market}`, structuredClone(songs));
  }
}

/**
 * D-080: each artist's resolved candidate songs, shared by every event and rebuild, in the
 * existing `artist_track_cache` table (mode `hits`, one row per artist and market).
 *
 * Interim encoding without a schema change: `spotify_track_ids[0]` is a JSON header
 * (`{"v":1,listeners,pages,exhausted}`), every later element is one song as JSON. Anything that
 * doesn't parse is a cache miss. A `candidates jsonb` column would be cleaner (proposed in D-080).
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ArtistSongs, ArtistSongsCache, CachedSong } from "@/application/ports/playlists";
import type { Database } from "@/db/client";
import { artistTrackCache } from "@/db/schema";
import {
  asArtistId,
  asSpotifyArtistId,
  asSpotifyTrackId,
  type ArtistId,
} from "@/domain/shared/ids";

const MODE = "hits";
const FORMAT_VERSION = 1;

const Header = z.object({
  v: z.literal(FORMAT_VERSION),
  spotifyArtistId: z.string().min(1).transform(asSpotifyArtistId),
  listeners: z.number().nullable(),
  pages: z.number().int().min(0),
  exhausted: z.boolean(),
  /** D-085: providers consulted; absent in rows written before setlist.fm. */
  providers: z.object({ setlistfm: z.object({ known: z.boolean() }).optional() }).optional(),
});

const Song = z.object({
  id: z.string().min(1).transform(asSpotifyTrackId),
  name: z.string(),
  artistIds: z.array(z.string().transform(asSpotifyArtistId)),
  isrc: z.string().nullable(),
  durationMs: z.number().int().min(0),
  releaseDate: z.string().nullable(),
  searchRank: z.number().int(),
  lastfmRank: z.number().int().nullable(),
  providerScores: z.object({ setlistfm: z.number().min(0).max(1).optional() }).optional(),
});

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

export function decodeArtistSongs(cells: readonly string[], fetchedAt: Date): ArtistSongs | null {
  const [head, ...rest] = cells;
  const header = Header.safeParse(head === undefined ? undefined : parseJson(head));
  if (!header.success) return null;
  const songs: CachedSong[] = [];
  for (const cell of rest) {
    const song = Song.safeParse(parseJson(cell));
    if (!song.success) return null;
    songs.push(song.data);
  }
  const { spotifyArtistId, listeners, pages, exhausted, providers } = header.data;
  return {
    spotifyArtistId,
    songs,
    listeners,
    pages,
    exhausted,
    fetchedAt,
    ...(providers ? { providers } : {}),
  };
}

export function encodeArtistSongs(songs: ArtistSongs): string[] {
  const header = {
    v: FORMAT_VERSION,
    spotifyArtistId: songs.spotifyArtistId,
    listeners: songs.listeners,
    pages: songs.pages,
    exhausted: songs.exhausted,
    providers: songs.providers,
  };
  return [JSON.stringify(header), ...songs.songs.map((s) => JSON.stringify(s))];
}

export class PgArtistSongsCache implements ArtistSongsCache {
  constructor(private readonly db: Database) {}

  async getMany(
    artistIds: readonly ArtistId[],
    market: string,
  ): Promise<Map<ArtistId, ArtistSongs>> {
    const out = new Map<ArtistId, ArtistSongs>();
    if (artistIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(artistTrackCache)
      .where(
        and(
          inArray(artistTrackCache.artistId, [...artistIds]),
          eq(artistTrackCache.mode, MODE),
          eq(artistTrackCache.market, market),
        ),
      );
    for (const row of rows) {
      const songs = decodeArtistSongs(row.spotifyTrackIds, row.fetchedAt);
      if (songs) out.set(asArtistId(row.artistId), songs);
    }
    return out;
  }

  /** Upsert on the natural key (artist, mode, market) (D-029). */
  async put(artistId: ArtistId, market: string, songs: ArtistSongs): Promise<void> {
    const cells = encodeArtistSongs(songs);
    await this.db
      .insert(artistTrackCache)
      .values({ artistId, mode: MODE, market, spotifyTrackIds: cells, fetchedAt: songs.fetchedAt })
      .onConflictDoUpdate({
        target: [artistTrackCache.artistId, artistTrackCache.mode, artistTrackCache.market],
        set: { spotifyTrackIds: cells, fetchedAt: songs.fetchedAt },
      });
  }
}

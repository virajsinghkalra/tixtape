import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ArtistSongs } from "@/application/ports/playlists";
import { artists } from "@/db/schema";
import {
  asArtistId,
  asSpotifyArtistId,
  asSpotifyTrackId,
  type ArtistId,
} from "@/domain/shared/ids";
import { MemoryCallCounterStore, PgCallCounterStore } from "@/infrastructure/spotify";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgArtistSongsCache } from "./artist-songs-cache";

const db = testDb();
const cache = new PgArtistSongsCache(db);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function newArtist(name: string): Promise<ArtistId> {
  const rows = await db
    .insert(artists)
    .values({ name, normalizedName: name.toLowerCase() })
    .returning({ id: artists.id });
  return asArtistId(rows[0]!.id);
}

const songs = (n: number, at = new Date("2026-11-22T10:00:00.000Z")): ArtistSongs => ({
  spotifyArtistId: asSpotifyArtistId("art1"),
  songs: Array.from({ length: n }, (_, i) => ({
    id: asSpotifyTrackId(`trk${i}`),
    name: `Song "${i}", with, commas`,
    artistIds: [asSpotifyArtistId("art1")],
    isrc: i % 2 ? null : `IN${i}`,
    durationMs: 200_000 + i,
    releaseDate: "2025-01-01",
    searchRank: i,
    lastfmRank: i < 3 ? i + 1 : null,
  })),
  listeners: 123_456,
  pages: 2,
  exhausted: false,
  fetchedAt: at,
});

describe("PgArtistSongsCache (D-080)", () => {
  it("round-trips an artist's songs and upserts on (artist, market)", async () => {
    const a = await newArtist("Ritviz");
    const b = await newArtist("Kayan");
    await cache.put(a, "IN", songs(12));
    await cache.put(a, "IN", songs(3));
    await cache.put(b, "US", songs(1));
    const got = await cache.getMany([a, b], "IN");
    expect([...got.keys()]).toEqual([a]);
    expect(got.get(a)).toEqual(songs(3));
  });

  it("treats a row it can't decode as a miss", async () => {
    const a = await newArtist("Odd");
    await db.execute(
      sql`insert into artist_track_cache (artist_id, mode, market, spotify_track_ids) values (${a}, 'hits', 'IN', ARRAY['not json'])`,
    );
    await expect(cache.getMany([a], "IN")).resolves.toEqual(new Map());
  });
});

describe("PgCallCounterStore (D-080)", () => {
  it("counts like the memory store, shared across connections", async () => {
    const other = testDb();
    try {
      const w = new Date("2026-11-22T10:00:00.000Z");
      const entries = [
        { key: "spotify:w:all", windowStart: w },
        { key: "spotify:w:match", windowStart: w },
      ];
      const pg = [new PgCallCounterStore(db), new PgCallCounterStore(other)];
      const mem = new MemoryCallCounterStore();
      await Promise.all([pg[0]!.increment(entries), pg[1]!.increment(entries)]);
      await mem.increment(entries);
      await mem.increment(entries);
      await expect(pg[0]!.read(entries)).resolves.toEqual(await mem.read(entries));
      await expect(pg[0]!.read([{ key: "spotify:w:none", windowStart: w }])).resolves.toEqual([0]);
    } finally {
      await other.$close();
    }
  });
});

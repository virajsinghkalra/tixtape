import { eq, inArray } from "drizzle-orm";
import type { PreviewTrack } from "@/application/ports/spotify";
import { sharedPlaylists } from "@/db/schema";
import { findPreviewAudio } from "@/infrastructure/previews/itunes";
import { container } from "./container";

export type FirstSong = { name: string; artist: string; audio: string };
export type ListenData = { song: FirstSong | null; tracks: { name: string; artist: string }[] };

/**
 * The first song in a playlist's "Inside" list that has a preview clip (looked up once, then
 * kept on the row: `audio` is the clip, "" means none was found). Null when nothing plays.
 */
export async function firstSongPreview(url: string): Promise<FirstSong | null> {
  return (await listenData(url)).song;
}

/** The first playable clip plus the playlist's top songs (names only), for the light player. */
export async function listenData(url: string): Promise<ListenData> {
  const db = container().db;
  const [row] = await db
    .select({ tracks: sharedPlaylists.previewTracks })
    .from(sharedPlaylists)
    .where(eq(sharedPlaylists.url, url))
    .limit(1);
  const tracks: PreviewTrack[] = row?.tracks ?? [];
  let changed = false;
  let found: FirstSong | null = null;
  for (const t of tracks) {
    if (t.audio === undefined) {
      t.audio = (await findPreviewAudio(t.name, t.artist)) ?? "";
      changed = true;
    }
    if (t.audio) {
      found = { name: t.name, artist: t.artist, audio: t.audio };
      break;
    }
  }
  if (changed) {
    await db
      .update(sharedPlaylists)
      .set({ previewTracks: tracks })
      .where(eq(sharedPlaylists.url, url))
      .catch(() => {});
  }
  return { song: found, tracks: tracks.map((t) => ({ name: t.name, artist: t.artist })) };
}

/**
 * The first stored clip per playlist url, in one query. Reads only what's already on the rows
 * (no clip lookups); playlists with no stored clip are absent. Never throws.
 */
export async function storedFirstSongs(urls: string[]): Promise<Map<string, FirstSong>> {
  const out = new Map<string, FirstSong>();
  if (urls.length === 0) return out;
  try {
    const rows = await container()
      .db.select({ url: sharedPlaylists.url, tracks: sharedPlaylists.previewTracks })
      .from(sharedPlaylists)
      .where(inArray(sharedPlaylists.url, urls));
    for (const r of rows) {
      const t = (r.tracks ?? []).find((x) => typeof x.audio === "string" && x.audio !== "");
      if (t) out.set(r.url, { name: t.name, artist: t.artist, audio: t.audio! });
    }
  } catch {
    // Best effort: the client fetches each song lazily.
  }
  return out;
}

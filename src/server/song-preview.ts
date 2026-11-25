import { eq } from "drizzle-orm";
import type { PreviewTrack } from "@/application/ports/spotify";
import { sharedPlaylists } from "@/db/schema";
import { findPreviewAudio } from "@/infrastructure/previews/itunes";
import { container } from "./container";

export type FirstSong = { name: string; artist: string; audio: string };

/**
 * The first song in a playlist's "Inside" list that has a preview clip (looked up once, then
 * kept on the row: `audio` is the clip, "" means none was found). Null when nothing plays.
 */
export async function firstSongPreview(url: string): Promise<FirstSong | null> {
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
  return found;
}

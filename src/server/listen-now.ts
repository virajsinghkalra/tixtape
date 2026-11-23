/** Read-only "Listen now" fallback data (DB only; no Spotify). */
import { readListenNow } from "@/infrastructure/db/listen-now-reader";
import {
  readNewestPlaylistUrl,
  readPlaylistPreview,
} from "@/infrastructure/db/shared-playlist-repository";
import { PgSpotifyGateStore } from "@/infrastructure/db/spotify-gate-store";
import type { ListenNow } from "@/domain/events/listen-now";
import type { EventId } from "@/domain/shared/ids";
import { container } from "./container";
import { playlists } from "./playlists";

/** `paused`: Spotify is on a cool-down, so "Make playlist" would only stall. */
export async function listenNow(
  eventId: string,
): Promise<(ListenNow & { paused: boolean }) | null> {
  const db = container().db;
  const now = new Date();
  const [data, until] = await Promise.all([
    readListenNow(db, eventId, now),
    new PgSpotifyGateStore(db).readPausedUntil(),
  ]);
  return data && { ...data, paused: until !== null && until > now };
}

/**
 * One tour, one playlist: an event with no playlist of its own reports its tour sibling's as
 * ready, so the page uses the same proven "Open in Spotify" path as any ready playlist.
 */
export async function sharedOrTourStatus(eventId: EventId): Promise<unknown> {
  const own = await playlists().getSharedStatus(eventId);
  if (own.status !== "none") return own;
  // The tour lookup is a bonus: if it fails, the event's own status still answers.
  const data = await Promise.resolve()
    .then(() => readListenNow(container().db, eventId, new Date()))
    .catch(() => null);
  return data?.sibling ? { status: "ready", url: data.sibling.url } : own;
}

/** "What's inside" a ready playlist (DB only; filled after each build). Never throws. */
export async function playlistInside(url: string | null) {
  if (!url) return null;
  return readPlaylistPreview(container().db, url).catch(() => null);
}

/**
 * One tour, one playlist: the playlist for a set of an artist's shows (the newest build among
 * them), with its first songs. DB only. Never throws.
 */
export async function tourPlaylist(eventIds: string[]) {
  try {
    const url = await readNewestPlaylistUrl(container().db, eventIds);
    if (!url) return null;
    return { url, inside: (await playlistInside(url))?.tracks ?? [] };
  } catch {
    return null;
  }
}

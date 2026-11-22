/** Read-only "Listen now" fallback data (DB only; no Spotify). */
import { readListenNow } from "@/infrastructure/db/listen-now-reader";
import { PgSpotifyGateStore } from "@/infrastructure/db/spotify-gate-store";
import type { ListenNow } from "@/domain/events/listen-now";
import { container } from "./container";

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

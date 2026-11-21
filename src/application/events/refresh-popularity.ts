/**
 * Fills `artists.lastfm_listeners` for the home ranking (D-079) using the Playlist Engine's
 * Last.fm source (D-065, no second client). Unknown or failing lookups store null (neutral).
 */
import type { ArtistPopularityStore } from "@/application/ports/event-feed";
import type { ArtistPopularitySource } from "@/application/ports/music-signals";

export const POPULARITY_MAX_AGE_DAYS = 7;

export async function refreshArtistPopularity(
  deps: { store: ArtistPopularityStore; source: ArtistPopularitySource; clock: { now(): Date } },
  limit: number,
): Promise<{ checked: number; known: number; failed: number }> {
  const now = deps.clock.now();
  const staleBefore = new Date(now.getTime() - POPULARITY_MAX_AGE_DAYS * 86_400_000);
  const due = await deps.store.due({ now, staleBefore, limit });
  let known = 0;
  let failed = 0;
  for (const a of due) {
    let listeners: number | null = null;
    try {
      listeners = await deps.source.listeners(a.name, a.mbid ? { mbid: a.mbid } : {});
    } catch {
      failed++;
    }
    if (listeners !== null) known++;
    await deps.store.save(a.id, listeners, now);
  }
  return { checked: due.length, known, failed };
}

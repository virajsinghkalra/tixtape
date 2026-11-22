/**
 * The ranked home page (D-079) for routes and pages. The page reads cookies (the visitor's city),
 * so it renders per request; the feed rows are cached here for 5 minutes per server instance,
 * and only the cheap, pure ranking runs per request.
 */
import { FEED_LIMIT, loadFrontPage } from "@/application/events/front-page";
import { refreshArtistPopularity } from "@/application/events/refresh-popularity";
import type { EventFeedReader, FeedRow } from "@/application/ports/event-feed";
import { PgArtistPopularityStore, PgEventFeed } from "@/infrastructure/db/event-feed";
import { LastfmPopularity } from "@/infrastructure/music-signals/lastfm";
import { env } from "@/lib/env";
import { container } from "./container";

const TTL_MS = 5 * 60_000;

let reader: EventFeedReader | undefined;
let cached: { at: number; rows: FeedRow[] } | undefined;

function feed(): EventFeedReader {
  if (reader) return reader;
  const db = new PgEventFeed(container().db);
  reader = {
    async upcoming(opts) {
      const now = Date.now();
      if (cached && now - cached.at < TTL_MS) {
        // QA-F-15: never serve a card for an event hidden or archived since it was cached (that
        // page would 404). Works across instances and for changes made by scripts.
        const live = await db.stillPublished(cached.rows.map((r) => r.id));
        return cached.rows.filter((r) => live.has(r.id));
      }
      const rows = await db.upcoming(opts);
      cached = { at: now, rows };
      return rows;
    },
  };
  return reader;
}

/** Drops this instance's cached feed (e.g. right after an admin publishes or holds an event). */
export function invalidateFeed(): void {
  cached = undefined;
}

export function frontPage(opts: { now: Date; city: string | null }) {
  return loadFrontPage(feed(), opts);
}

/**
 * Refreshes cached Last.fm listeners for artists in upcoming events (D-079), through the same
 * Last.fm adapter the Playlist Engine uses (D-065). Skipped without LASTFM_API_KEY.
 */
export async function refreshPopularity(limit: number) {
  const apiKey = env().LASTFM_API_KEY;
  if (!apiKey) return null;
  const c = container();
  const source = new LastfmPopularity({
    apiKey,
    fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clock: c.clock,
  });
  return refreshArtistPopularity(
    { store: new PgArtistPopularityStore(c.db), source, clock: c.clock },
    limit,
  );
}

/** Every upcoming show (same 5-minute cache as the home page) for the browse pages. */
export function upcomingRows(now: Date): Promise<FeedRow[]> {
  return feed().upcoming({ from: now, limit: FEED_LIMIT });
}

const PAST_DAYS = 60;

/** Shows that ended in the last 60 days, most recent first, for /past (read-only, uncached). */
export function pastRows(now: Date): Promise<FeedRow[]> {
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  return new PgEventFeed(container().db).past({ from, to: now, limit: FEED_LIMIT });
}

const OPENS_DAYS = 7;
let opensCache: { at: number; opens: Map<string, number> } | undefined;

/** Spotify-open taps per event over the last 7 days, cached 5 minutes. Empty if unreadable. */
export async function recentSpotifyOpens(now: Date): Promise<Map<string, number>> {
  if (opensCache && now.getTime() - opensCache.at < TTL_MS) return opensCache.opens;
  const since = new Date(now.getTime() - OPENS_DAYS * 86_400_000);
  const opens = await new PgEventFeed(container().db).spotifyOpensSince(since).catch(() => null);
  if (!opens) return opensCache?.opens ?? new Map();
  opensCache = { at: now.getTime(), opens };
  return opens;
}

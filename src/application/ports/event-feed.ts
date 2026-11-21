/**
 * The home feed (D-079): every upcoming published event with what ranking and cards need, read
 * in one round trip (no per-card lookups). Implemented in src/infrastructure/db/event-feed.ts.
 */
import type { FeedEvent } from "@/domain/events/front-page";
import type { VisualArtist } from "@/domain/visuals/visuals";
import type { EventSummary } from "./events";

export type FeedRow = EventSummary &
  FeedEvent & {
    /** A solo show's artist photo (Spotify), for cards and stories. */
    soloImage: string | null;
    /** The top-billed tier with their photos (Spotify, alt + credit), in billing order (D-083). */
    headlinerArtists: VisualArtist[];
    /** The first official page any source gave ("Buy tickets"). */
    ticketUrl: string | null;
    /** UX #6: the shared playlist is live, being made, or not started. */
    playlistStatus: "ready" | "building" | null;
  };

export interface EventFeedReader {
  /** Published events still running or upcoming from `from`, soonest first, at most `limit`. */
  upcoming(opts: { from: Date; limit: number }): Promise<FeedRow[]>;
}

/** The per-artist Last.fm listeners cache that ranks the home page (D-079). */
export interface ArtistPopularityStore {
  /** Artists in upcoming published events whose count is missing or older than `staleBefore`. */
  due(opts: {
    now: Date;
    staleBefore: Date;
    limit: number;
  }): Promise<{ id: string; name: string; mbid: string | null }[]>;
  save(artistId: string, listeners: number | null, at: Date): Promise<void>;
}

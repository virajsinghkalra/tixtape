/** One public playlist per concert (D-036). The event id is the natural key. */
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { SharedPlaylist, SharedPlaylistRepository } from "@/application/ports/playlists";
import type { PreviewTrack } from "@/application/ports/spotify";
import type { Database } from "@/db/client";
import { events, sharedPlaylists } from "@/db/schema";
import {
  asEventId,
  asSpotifyPlaylistId,
  type EventId,
  type SpotifyPlaylistId,
} from "@/domain/shared/ids";

type Row = typeof sharedPlaylists.$inferSelect;

const toShared = (row: Row): SharedPlaylist => ({
  eventId: asEventId(row.eventId),
  spotifyPlaylistId: asSpotifyPlaylistId(row.spotifyPlaylistId),
  url: row.url,
  trackIds: row.trackIds,
  snapshotId: row.snapshotId,
  lineupHashAtBuild: row.lineupHashAtBuild,
  optionsVersion: row.optionsVersion,
  builtAt: row.builtAt,
});

export class PgSharedPlaylistRepository implements SharedPlaylistRepository {
  constructor(private readonly db: Database) {}

  async findByEvent(eventId: EventId): Promise<SharedPlaylist | null> {
    const rows = await this.db
      .select()
      .from(sharedPlaylists)
      .where(eq(sharedPlaylists.eventId, eventId));
    return rows[0] ? toShared(rows[0]) : null;
  }

  async saveCreated(
    eventId: EventId,
    playlist: { spotifyPlaylistId: SpotifyPlaylistId; url: string },
  ): Promise<SharedPlaylist> {
    const inserted = await this.db
      .insert(sharedPlaylists)
      .values({ eventId, ...playlist, trackIds: [] })
      .onConflictDoNothing({ target: sharedPlaylists.eventId })
      .returning();
    const row = inserted[0] ? toShared(inserted[0]) : await this.findByEvent(eventId);
    if (!row) throw new Error("shared_playlists insert returned no row");
    return row;
  }

  async markBuilt(
    eventId: EventId,
    build: {
      trackIds: string[];
      snapshotId: string | null;
      lineupHash: string | null;
      at: Date;
      optionsVersion?: number;
    },
  ): Promise<void> {
    await this.db
      .update(sharedPlaylists)
      .set({
        trackIds: build.trackIds,
        snapshotId: build.snapshotId,
        lineupHashAtBuild: build.lineupHash,
        optionsVersion: build.optionsVersion ?? 1,
        builtAt: build.at,
        // The songs changed: the old preview is stale until the build reads the new one.
        previewTracks: null,
        updatedAt: sql`now()`,
      })
      .where(eq(sharedPlaylists.eventId, eventId));
  }

  async savePreview(eventId: EventId, tracks: PreviewTrack[]): Promise<void> {
    await this.db
      .update(sharedPlaylists)
      .set({ previewTracks: tracks.slice(0, 10), updatedAt: sql`now()` })
      .where(eq(sharedPlaylists.eventId, eventId));
  }
}

/** "What's inside" for a playlist URL (an event's own or its tour's): songs and the total. */
export async function readPlaylistPreview(
  db: Database,
  url: string,
): Promise<{ tracks: PreviewTrack[]; total: number } | null> {
  const rows = await db
    .select({ tracks: sharedPlaylists.previewTracks, ids: sharedPlaylists.trackIds })
    .from(sharedPlaylists)
    .where(eq(sharedPlaylists.url, url))
    .limit(1);
  const row = rows[0];
  if (!row?.tracks?.length) return null;
  return { tracks: row.tracks, total: row.ids.length };
}

/**
 * D-085: events whose shared playlist is stale (built by an older selection algorithm, or for
 * an older lineup), soonest first, for the sweep to refresh in place. Upcoming events only;
 * the sweep's build start still checks visibility (unpublished events 404).
 */
export async function listStaleSharedPlaylists(
  db: Database,
  opts: { currentVersion: number; now: Date; limit: number },
): Promise<EventId[]> {
  const rows = await db
    .select({ eventId: sharedPlaylists.eventId })
    .from(sharedPlaylists)
    .innerJoin(events, eq(events.id, sharedPlaylists.eventId))
    .where(
      and(
        isNotNull(sharedPlaylists.lineupHashAtBuild),
        sql`coalesce(${events.endsAt}, ${events.startsAt}) >= ${opts.now.toISOString()}::timestamptz`,
        or(
          lt(sharedPlaylists.optionsVersion, opts.currentVersion),
          sql`${events.lineupHash} is distinct from ${sharedPlaylists.lineupHashAtBuild}`,
        ),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(opts.limit);
  return rows.map((r) => asEventId(r.eventId));
}

/** The newest-built playlist among these events (a tour's shows), or null. */
export async function readNewestPlaylistUrl(
  db: Database,
  eventIds: readonly string[],
): Promise<string | null> {
  if (eventIds.length === 0) return null;
  const rows = await db
    .select({ url: sharedPlaylists.url })
    .from(sharedPlaylists)
    .where(inArray(sharedPlaylists.eventId, [...eventIds]))
    .orderBy(desc(sharedPlaylists.builtAt))
    .limit(1);
  return rows[0]?.url ?? null;
}

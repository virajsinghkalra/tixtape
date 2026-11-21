/** One public playlist per concert (D-036). The event id is the natural key. */
import { eq, sql } from "drizzle-orm";
import type { SharedPlaylist, SharedPlaylistRepository } from "@/application/ports/playlists";
import type { Database } from "@/db/client";
import { sharedPlaylists } from "@/db/schema";
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
    build: { trackIds: string[]; snapshotId: string | null; lineupHash: string | null; at: Date },
  ): Promise<void> {
    await this.db
      .update(sharedPlaylists)
      .set({
        trackIds: build.trackIds,
        snapshotId: build.snapshotId,
        lineupHashAtBuild: build.lineupHash,
        builtAt: build.at,
        updatedAt: sql`now()`,
      })
      .where(eq(sharedPlaylists.eventId, eventId));
  }
}

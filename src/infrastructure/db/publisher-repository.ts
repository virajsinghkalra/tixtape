/** The single `spotify_publisher` row (id = 1, D-036). */
import { eq } from "drizzle-orm";
import type { PublisherRecord, PublisherRepository } from "@/application/ports/playlists";
import type { Database } from "@/db/client";
import { spotifyPublisher } from "@/db/schema";
import { asUserId, type UserId } from "@/domain/shared/ids";

const PUBLISHER_ROW_ID = 1;

export class PgPublisherRepository implements PublisherRepository {
  constructor(private readonly db: Database) {}

  async find(): Promise<PublisherRecord | null> {
    const rows = await this.db
      .select()
      .from(spotifyPublisher)
      .where(eq(spotifyPublisher.id, PUBLISHER_ROW_ID));
    const row = rows[0];
    return row ? { userId: asUserId(row.userId), connectedAt: row.connectedAt } : null;
  }

  async set(userId: UserId, at: Date): Promise<void> {
    await this.db
      .insert(spotifyPublisher)
      .values({ id: PUBLISHER_ROW_ID, userId, connectedAt: at })
      .onConflictDoUpdate({ target: spotifyPublisher.id, set: { userId, connectedAt: at } });
  }
}

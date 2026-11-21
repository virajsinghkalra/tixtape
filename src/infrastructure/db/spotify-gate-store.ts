import { eq, sql } from "drizzle-orm";
import type { SpotifyGateStore } from "@/application/ports/spotify";
import type { Database } from "@/db/client";
import { spotifyGate } from "@/db/schema";

const GATE_ROW_ID = 1;

/** The shared Spotify pause in Postgres (D-006). */
export class PgSpotifyGateStore implements SpotifyGateStore {
  constructor(private readonly db: Database) {}

  async readPausedUntil(): Promise<Date | null> {
    const rows = await this.db
      .select({ pausedUntil: spotifyGate.pausedUntil })
      .from(spotifyGate)
      .where(eq(spotifyGate.id, GATE_ROW_ID));
    return rows[0]?.pausedUntil ?? null;
  }

  /** One atomic upsert; GREATEST keeps whichever deadline is later (NULLs are ignored). */
  async extendPausedUntil(until: Date): Promise<Date> {
    const rows = await this.db
      .insert(spotifyGate)
      .values({ id: GATE_ROW_ID, pausedUntil: until })
      .onConflictDoUpdate({
        target: spotifyGate.id,
        set: { pausedUntil: sql`GREATEST(${spotifyGate.pausedUntil}, excluded.paused_until)` },
      })
      .returning({ pausedUntil: spotifyGate.pausedUntil });
    const pausedUntil = rows[0]?.pausedUntil;
    if (!pausedUntil) throw new Error("spotify_gate upsert returned no row");
    return pausedUntil;
  }
}

/** Shared by the events repositories' integration tests: truncates only the tables they touch. */
import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";

export async function truncateEventTables(db: Database): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE event_artists, event_sources, events, venue_aliases, venues,
      artist_aliases, artists, ingest_runs
    RESTART IDENTITY CASCADE`);
}

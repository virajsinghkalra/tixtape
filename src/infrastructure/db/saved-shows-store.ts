/**
 * D-092: the server copy of saved shows, keyed by person and only for a person with an email
 * (D-090 opt-in). Reached through the device ID, so a caller only ever sees its own person's
 * rows. Times only move forward (`greatest`), so replays and races can't undo a later action.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SavedChanges, SavedShowsStore, SyncedShow } from "@/application/ports/analytics";
import type { Database } from "@/db/client";
import { devices, events, people, savedShows, venues } from "@/db/schema";

export class PgSavedShowsStore implements SavedShowsStore {
  constructor(private readonly db: Database) {}

  private async emailedPerson(deviceId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: people.id })
      .from(devices)
      .innerJoin(people, eq(people.id, devices.personId))
      .where(and(eq(devices.id, deviceId), isNotNull(people.email)));
    return row?.id ?? null;
  }

  async list(deviceId: string): Promise<{ synced: boolean; shows: SyncedShow[] }> {
    const personId = await this.emailedPerson(deviceId);
    if (!personId) return { synced: false, shows: [] };
    const rows = await this.db
      .select({
        eventId: savedShows.eventId,
        savedAt: savedShows.savedAt,
        removedAt: savedShows.removedAt,
        title: events.title,
        startsAt: events.startsAt,
        visibility: events.visibility,
        city: venues.city,
      })
      .from(savedShows)
      .innerJoin(events, eq(events.id, savedShows.eventId))
      .leftJoin(venues, eq(venues.id, events.venueId))
      .where(eq(savedShows.personId, personId))
      .limit(200);
    return {
      synced: true,
      shows: rows.map((r) => ({
        eventId: r.eventId,
        savedAt: r.savedAt.toISOString(),
        removedAt: r.removedAt?.toISOString() ?? null,
        // D-058: a held show leaves no trace, not even its title.
        show:
          r.visibility === "held"
            ? null
            : { title: r.title, startsAt: r.startsAt.toISOString(), city: r.city ?? null },
      })),
    };
  }

  async apply(deviceId: string, changes: SavedChanges): Promise<boolean> {
    const personId = await this.emailedPerson(deviceId);
    if (!personId) return false;
    const ids = [...changes.saves, ...changes.removes].map((c) => c.eventId);
    if (ids.length === 0) return true;
    // Unknown event IDs are skipped instead of failing the whole batch.
    const known = new Set(
      (await this.db.select({ id: events.id }).from(events).where(inArray(events.id, ids))).map(
        (e) => e.id,
      ),
    );
    await this.db.transaction(async (tx) => {
      for (const s of changes.saves.filter((c) => known.has(c.eventId))) {
        await tx
          .insert(savedShows)
          .values({ personId, eventId: s.eventId, savedAt: s.at })
          .onConflictDoUpdate({
            target: [savedShows.personId, savedShows.eventId],
            set: { savedAt: sql`greatest(${savedShows.savedAt}, excluded.saved_at)` },
          });
      }
      for (const r of changes.removes.filter((c) => known.has(c.eventId))) {
        // A removal for a show never saved here still records the unsave (it may win later).
        await tx
          .insert(savedShows)
          .values({ personId, eventId: r.eventId, savedAt: new Date(0), removedAt: r.at })
          .onConflictDoUpdate({
            target: [savedShows.personId, savedShows.eventId],
            set: {
              removedAt: sql`greatest(coalesce(${savedShows.removedAt}, excluded.removed_at), excluded.removed_at)`,
            },
          });
      }
    });
    return true;
  }
}

/**
 * D-056 columns on `events`: visibility, confidence, verification, last_verified_at. Written
 * only by the collector (held, re-verification, archive) and the Lead's publish command.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { EventVerificationStore, EventVisibility } from "@/application/ingestion/ports";
import type { Database } from "@/db/client";
import { artists, eventArtists, events } from "@/db/schema";
import type { Verification } from "@/domain/events/extract/verify";
import { NO_IMAGE, type EventVisual } from "@/domain/events/publish-visual";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { eventVisual } from "./event-visual";

export class PgEventVerificationRepository implements EventVerificationStore {
  constructor(private readonly db: Database) {}

  async save(eventId: EventId, verification: Verification, checkedAt: Date): Promise<void> {
    // D-091: re-verification rewrites the object but must keep a `no_image` hold, or the
    // daily retry would never see the event again.
    const kept = sql`case when coalesce(${events.verification}->'flags', '[]'::jsonb) ? ${NO_IMAGE}
      and not (${JSON.stringify(verification.flags)}::jsonb ? ${NO_IMAGE})
      then jsonb_set(${JSON.stringify(verification)}::jsonb, '{flags}',
        ${JSON.stringify(verification.flags)}::jsonb || to_jsonb(${NO_IMAGE}::text))
      else ${JSON.stringify(verification)}::jsonb end`;
    await this.db
      .update(events)
      .set({ verification: kept, confidence: verification.confidence, lastVerifiedAt: checkedAt })
      .where(eq(events.id, eventId));
  }

  async get(eventId: EventId) {
    const rows = await this.db
      .select({
        title: events.title,
        visibility: events.visibility,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        verification: events.verification,
        lastVerifiedAt: events.lastVerifiedAt,
      })
      .from(events)
      .where(eq(events.id, eventId));
    const row = rows[0];
    if (!row) return null;
    return { ...row, verification: (row.verification as Verification | null) ?? null };
  }

  async listMissingLineups(now: Date): Promise<string[]> {
    const rows = await this.db
      .select({ title: events.title })
      .from(events)
      .where(
        and(
          inArray(events.visibility, ["held", "published"]),
          sql`coalesce(${events.endsAt}, ${events.startsAt}) >= ${now.toISOString()}::timestamptz`,
          sql`coalesce(${events.verification}->'fields'->'headliners'->>'status', 'missing') in ('missing', 'single')`,
        ),
      );
    return rows.map((r) => r.title);
  }

  async setVisibility(eventId: EventId, visibility: EventVisibility): Promise<void> {
    await this.db.update(events).set({ visibility }).where(eq(events.id, eventId));
  }

  visualOf(eventId: EventId): Promise<EventVisual | null> {
    return eventVisual(this.db, eventId);
  }

  async setImageHold(eventId: EventId, held: boolean): Promise<void> {
    // `verification` is always a full object here; an unverified event has no flags to keep.
    const flags = held
      ? sql`(select coalesce(jsonb_agg(distinct f), '[]'::jsonb) from jsonb_array_elements_text(
              coalesce(${events.verification}->'flags', '[]'::jsonb) || to_jsonb(${NO_IMAGE}::text)) f)`
      : sql`(select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements_text(
              coalesce(${events.verification}->'flags', '[]'::jsonb)) f where f <> ${NO_IMAGE})`;
    await this.db
      .update(events)
      .set({ verification: sql`jsonb_set(${events.verification}, '{flags}', ${flags})` })
      .where(and(eq(events.id, eventId), sql`${events.verification} is not null`));
  }

  async listImageHolds(now: Date, limit: number): Promise<EventId[]> {
    const rows = await this.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.visibility, "held"),
          sql`coalesce(${events.endsAt}, ${events.startsAt}) >= ${now.toISOString()}::timestamptz`,
          sql`coalesce(${events.verification}->'flags', '[]'::jsonb) ? ${NO_IMAGE}`,
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(limit);
    return rows.map((r) => asEventId(r.id));
  }

  async archivePast(now: Date): Promise<number> {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const rows = await this.db
      .update(events)
      .set({ visibility: "archived" })
      .where(
        and(
          inArray(events.visibility, ["held", "published"]),
          sql`coalesce(${events.endsAt}, ${events.startsAt}) < ${dayAgo.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: events.id });
    return rows.length;
  }

  async pastLineups(seriesKey: string, before: Date): Promise<string[][]> {
    if (seriesKey === "") return [];
    const rows = await this.db
      .select({ eventId: events.id, name: artists.name })
      .from(events)
      .innerJoin(eventArtists, eq(eventArtists.eventId, events.id))
      .innerJoin(artists, eq(artists.id, eventArtists.artistId))
      .where(
        and(
          sql`split_part(${events.dedupeKey}, '|', 1) = ${seriesKey}`,
          lt(events.startsAt, before),
        ),
      )
      .orderBy(asc(events.id), asc(eventArtists.billingRank));
    const byEvent = new Map<string, string[]>();
    for (const r of rows) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r.name]);
    return [...byEvent.values()];
  }
}

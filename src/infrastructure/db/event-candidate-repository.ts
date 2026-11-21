/**
 * `event_candidates` (D-053): collector candidates kept between runs so corroboration can
 * span runs (Rolling Stone India is read once per crawl-delay window). Natural key
 * (source, external_id); every write is an upsert (D-029). Only facts and links are stored.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { CandidateStore, StoredCandidate } from "@/application/ingestion/ports";
import type { Database } from "@/db/client";
import { eventCandidates } from "@/db/schema";
import { COLLECTOR_SOURCES, type ValidatedCandidate } from "@/domain/events/extract/candidate";
import { httpUrl } from "@/domain/events/http-url";
import type { EventId } from "@/domain/shared/ids";
import { EVENT_TYPES, type EventSource } from "@/domain/shared/lineup";

/** The payload column: a validated candidate with ISO dates (D-073 gig stores extend it). */
export const CandidatePayloadSchema = z.object({
  source: z.enum(COLLECTOR_SOURCES),
  trust: z.enum(["official", "trusted", "structured"]),
  externalId: z.string().min(1),
  url: httpUrl(),
  title: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  city: z.string().min(1),
  country: z.string().length(2),
  venueName: z.string().nullable(),
  artists: z.array(z.string()),
  supportActs: z.array(z.string()).default([]),
  dateExplicit: z.boolean().default(false),
  fingerprint: z.string().optional(),
  confidence: z.number(),
});

function toPayload(c: ValidatedCandidate): z.infer<typeof CandidatePayloadSchema> {
  return {
    ...c,
    artists: [...c.artists],
    supportActs: [...c.supportActs],
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt?.toISOString() ?? null,
  };
}

export class PgEventCandidateRepository implements CandidateStore {
  constructor(private readonly db: Database) {}

  async upsert(candidate: ValidatedCandidate, dedupeKey: string, seenAt: Date): Promise<void> {
    // Generic web pages (D-064) have no `event_source` value yet: they count within a run only.
    if (candidate.source === "web") return;
    const source = candidate.source;
    const payload = toPayload(candidate);
    await this.db
      .insert(eventCandidates)
      .values({
        dedupeKey,
        source,
        externalId: candidate.externalId,
        url: candidate.url,
        payload,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: [eventCandidates.source, eventCandidates.externalId],
        set: { dedupeKey, url: candidate.url, payload, lastSeenAt: seenAt },
      });
  }

  async listUpcoming(from: Date, seenSince: Date): Promise<StoredCandidate[]> {
    // Ends (or starts) at or after `from`; small table, filtered on the JSON dates.
    const rows = await this.db
      .select()
      .from(eventCandidates)
      .where(
        and(
          gte(eventCandidates.lastSeenAt, seenSince),
          sql`coalesce(${eventCandidates.payload}->>'endsAt', ${eventCandidates.payload}->>'startsAt') >= ${from.toISOString()}`,
        ),
      );
    const out: StoredCandidate[] = [];
    for (const row of rows) {
      const p = CandidatePayloadSchema.safeParse(row.payload);
      if (!p.success) continue;
      out.push({
        candidate: {
          ...p.data,
          startsAt: new Date(p.data.startsAt),
          endsAt: p.data.endsAt === null ? null : new Date(p.data.endsAt),
        },
        publishedEventId: (row.publishedEventId as EventId | null) ?? null,
        lastSeenAt: row.lastSeenAt,
      });
    }
    return out;
  }

  async deleteStale(before: Date): Promise<number> {
    const rows = await this.db
      .delete(eventCandidates)
      .where(lt(eventCandidates.lastSeenAt, before))
      .returning({ id: eventCandidates.id });
    return rows.length;
  }

  async markPublished(source: EventSource, externalId: string, eventId: EventId): Promise<void> {
    await this.db
      .update(eventCandidates)
      .set({ publishedEventId: eventId })
      .where(and(eq(eventCandidates.source, source), eq(eventCandidates.externalId, externalId)));
  }
}

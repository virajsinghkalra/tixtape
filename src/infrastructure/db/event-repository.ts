import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type {
  AdminEventDetail,
  AdminEventSummary,
  DedupeCandidate,
  EventFields,
  EventListFilter,
  EventMerge,
  EventMergeOutcome,
  EventRecord,
  EventRepository,
  EventWrite,
} from "@/application/ports/events";
import type { Database } from "@/db/client";
import { mergeEventFields, sourceRank, topSource } from "@/domain/events/dedupe";
import type { EventVisual } from "@/domain/events/publish-visual";
import type { EventVisibility } from "@/domain/events/visibility";
import { eventVisual, eventVisuals } from "./event-visual";
import {
  artists,
  eventArtists,
  eventCandidates,
  eventMergeReviews,
  events,
  eventSources,
  eventStats,
  playlistJobs,
  playlists,
  searchLog,
  sharedPlaylists,
  venues,
} from "@/db/schema";
import {
  asArtistId,
  asEventId,
  asSpotifyArtistId,
  asVenueId,
  type EventId,
} from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { isUniqueViolation } from "./pg-errors";
import { eventEndSql } from "./event-time";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type EventRow = typeof events.$inferSelect;
type VenueRow = typeof venues.$inferSelect;

const artistCount = sql<number>`(select count(*) from ${eventArtists} where ${eventArtists.eventId} = ${events.id})::int`;

const toSummary = (e: EventRow, v: VenueRow | null, count: number): AdminEventSummary => ({
  id: asEventId(e.id),
  title: e.title,
  type: e.type,
  status: e.status,
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  genre: e.genre,
  imageUrl: e.imageUrl,
  posterUrl: e.posterUrl,
  posterCredit: e.posterCredit,
  venue: v ? { id: asVenueId(v.id), name: v.name, city: v.city, country: v.country } : null,
  artistCount: count,
  visibility: e.visibility,
  confidence: e.confidence,
  lastVerifiedAt: e.lastVerifiedAt,
  announcedActs: announcedActs(e.verification),
});

/** D-091: `verification.lineupCompleteness.announced`, when a verification recorded it. */
function announcedActs(verification: unknown): number | null {
  const n = (verification as { lineupCompleteness?: { announced?: unknown } } | null)
    ?.lineupCompleteness?.announced;
  return typeof n === "number" ? n : null;
}

/** `%` and `_` in user search text are literals, not wildcards. */
const escapeLike = (s: string) => s.replace(/[\\%_]/gu, (c) => `\\${c}`);

export class PgEventRepository implements EventRepository, EventMerge {
  constructor(private readonly db: Database) {}

  async findIdBySourceRef(source: EventSource, externalId: string): Promise<EventId | null> {
    const rows = await this.db
      .select({ id: eventSources.eventId })
      .from(eventSources)
      .where(and(eq(eventSources.source, source), eq(eventSources.externalId, externalId)));
    return rows[0] ? asEventId(rows[0].id) : null;
  }

  async findIdByDedupeKey(dedupeKey: string): Promise<EventId | null> {
    const rows = await this.db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.dedupeKey, dedupeKey));
    return rows[0] ? asEventId(rows[0].id) : null;
  }

  async findById(id: EventId): Promise<EventRecord | null> {
    const rows = await this.db.select().from(events).where(eq(events.id, id));
    const e = rows[0];
    if (!e) return null;
    const sources = await this.db
      .select({ source: eventSources.source })
      .from(eventSources)
      .where(eq(eventSources.eventId, id));
    return {
      id: asEventId(e.id),
      ...fieldsOf(e),
      dedupeKey: e.dedupeKey,
      lineupHash: e.lineupHash,
      sources: [...new Set(sources.map((s) => s.source))],
    };
  }

  async listDedupeCandidates(block: {
    country: string;
    city: string;
    from: Date;
    to: Date;
  }): Promise<DedupeCandidate[]> {
    const rows = await this.db
      .select({ event: events, venue: venues })
      .from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(
        and(
          eq(venues.country, block.country),
          eq(venues.city, block.city),
          gte(events.startsAt, block.from),
          lte(events.startsAt, block.to),
        ),
      );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.event.id);
    const [keys, sources] = await Promise.all([
      this.db
        .select({ eventId: eventArtists.eventId, name: artists.normalizedName })
        .from(eventArtists)
        .innerJoin(artists, eq(artists.id, eventArtists.artistId))
        .where(inArray(eventArtists.eventId, ids)),
      this.db
        .select({ eventId: eventSources.eventId, source: eventSources.source })
        .from(eventSources)
        .where(inArray(eventSources.eventId, ids)),
    ]);
    return rows.map(({ event, venue }) => ({
      id: asEventId(event.id),
      title: event.title,
      startsAt: event.startsAt,
      startsAtDateOnly: event.startsAtDateOnly,
      country: venue.country,
      city: venue.city,
      venueName: venue.name,
      artistKeys: keys.filter((k) => k.eventId === event.id).map((k) => k.name),
      sources: [...new Set(sources.filter((s) => s.eventId === event.id).map((s) => s.source))],
    }));
  }

  async save(write: EventWrite): Promise<EventId> {
    try {
      return await this.db.transaction(async (tx) => {
        const id = await this.upsertEvent(tx, write);
        await tx
          .insert(eventSources)
          .values({
            eventId: id,
            source: write.source.source,
            externalId: write.source.externalId ?? id,
            url: write.source.url,
            raw: write.source.raw,
            lastSeenAt: write.source.seenAt,
          })
          .onConflictDoUpdate({
            target: [eventSources.source, eventSources.externalId],
            set: { url: write.source.url, raw: write.source.raw, lastSeenAt: write.source.seenAt },
          });
        if (write.lineup) {
          await tx.delete(eventArtists).where(eq(eventArtists.eventId, id));
          if (write.lineup.rows.length > 0) {
            await tx
              .insert(eventArtists)
              .values(write.lineup.rows.map((r) => ({ ...r, eventId: id })));
          }
          await tx.update(events).set({ lineupHash: write.lineup.hash }).where(eq(events.id, id));
        }
        return id;
      });
    } catch (e) {
      if (isUniqueViolation(e, "events_dedupe_key_uq")) {
        throw new ConflictError(
          "Another event already has this title, date and city. Edit that event instead.",
          { cause: e },
        );
      }
      throw e;
    }
  }

  private async upsertEvent(tx: Tx, write: EventWrite): Promise<EventId> {
    const values = {
      ...write.fields,
      dedupeKey: write.dedupeKey,
      ...(write.visibility === undefined ? {} : { visibility: write.visibility }),
    };
    if (write.id === null) {
      const rows = await tx.insert(events).values(values).returning({ id: events.id });
      if (!rows[0]) throw new Error("events insert returned no row");
      return asEventId(rows[0].id);
    }
    const rows = await tx
      .update(events)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(events.id, write.id))
      .returning({ id: events.id });
    if (!rows[0]) throw new NotFoundError("That event no longer exists.");
    return write.id;
  }

  visualOf(id: EventId): Promise<EventVisual | null> {
    return eventVisual(this.db, id);
  }

  listVisuals(visibility: EventVisibility, from: Date, limit: number) {
    return eventVisuals(
      this.db,
      sql`e.visibility = ${visibility} and coalesce(e.ends_at, e.starts_at) >= ${from.toISOString()}::timestamptz`,
      limit,
    );
  }

  async setPoster(id: EventId, posterUrl: string | null): Promise<boolean> {
    const rows = await this.db
      .update(events)
      .set({
        posterUrl,
        posterSource: posterUrl === null ? null : "admin",
        posterCredit: null,
        posterCheckedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(events.id, id))
      .returning({ id: events.id });
    return rows.length > 0;
  }

  async setVisibility(id: EventId, visibility: EventVisibility): Promise<boolean> {
    const rows = await this.db
      .update(events)
      .set({ visibility, updatedAt: sql`now()` })
      .where(eq(events.id, id))
      .returning({ id: events.id });
    return rows.length > 0;
  }

  async getDetail(id: EventId): Promise<AdminEventDetail | null> {
    const rows = await this.db
      .select({ event: events, venue: venues })
      .from(events)
      .leftJoin(venues, eq(venues.id, events.venueId))
      .where(eq(events.id, id));
    const row = rows[0];
    if (!row) return null;
    const [lineup, sources] = await Promise.all([
      this.db
        .select({ ea: eventArtists, artist: artists })
        .from(eventArtists)
        .innerJoin(artists, eq(artists.id, eventArtists.artistId))
        .where(eq(eventArtists.eventId, id))
        .orderBy(asc(eventArtists.billingRank)),
      this.db
        .select()
        .from(eventSources)
        .where(eq(eventSources.eventId, id))
        .orderBy(asc(eventSources.source)),
    ]);
    return {
      ...toSummary(row.event, row.venue, lineup.length),
      lineupHash: row.event.lineupHash,
      lineup: lineup.map(({ ea, artist }) => ({
        artistId: asArtistId(artist.id),
        name: artist.name,
        billingRank: ea.billingRank,
        tier: ea.tier,
        day: ea.day,
        stage: ea.stage,
        matchStatus: artist.matchStatus,
        spotifyId: artist.spotifyId === null ? null : asSpotifyArtistId(artist.spotifyId),
        imageUrl: artist.imageUrl,
        altImageUrl: artist.altImageUrl,
        altImageCredit: artist.altImageCredit,
      })),
      sources: sources.map((s) => ({
        source: s.source,
        externalId: s.externalId,
        url: s.url,
        lastSeenAt: s.lastSeenAt,
      })),
      createdAt: row.event.createdAt,
      updatedAt: row.event.updatedAt,
    };
  }

  async list(filter: EventListFilter): Promise<{ items: AdminEventSummary[]; total: number }> {
    const conditions: SQL[] = [];
    if (filter.visibility !== null) conditions.push(eq(events.visibility, filter.visibility));
    if (filter.city !== undefined) conditions.push(eq(venues.city, filter.city));
    // A date-only show without an end counts until the end of its IST day, so `from=now`
    // still lists tonight's show after midnight.
    if (filter.from !== undefined)
      conditions.push(
        sql`case when ${events.startsAtDateOnly} and ${events.endsAt} is null
          then ${eventEndSql({ startsAt: events.startsAt, endsAt: events.endsAt, dateOnly: events.startsAtDateOnly })}
          else ${events.startsAt} end >= ${filter.from.toISOString()}::timestamptz`,
      );
    if (filter.to !== undefined) conditions.push(lte(events.startsAt, filter.to));
    if (filter.type !== undefined) conditions.push(eq(events.type, filter.type));
    if (filter.q !== undefined) conditions.push(ilike(events.title, `%${escapeLike(filter.q)}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, counted] = await Promise.all([
      this.db
        .select({ event: events, venue: venues, artistCount })
        .from(events)
        .leftJoin(venues, eq(venues.id, events.venueId))
        .where(where)
        .orderBy(asc(events.startsAt), asc(events.id))
        .limit(filter.limit)
        .offset(filter.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(events)
        .leftJoin(venues, eq(venues.id, events.venueId))
        .where(where),
    ]);
    return {
      items: rows.map((r) => toSummary(r.event, r.venue, r.artistCount)),
      total: counted[0]?.total ?? 0,
    };
  }

  /** D-028. A re-scored pair keeps one row with the latest score. */
  async recordMergeReview(eventId: EventId, similarTo: EventId, score: number): Promise<void> {
    await this.db
      .insert(eventMergeReviews)
      .values({ eventId, similarTo, score })
      .onConflictDoUpdate({
        target: [eventMergeReviews.eventId, eventMergeReviews.similarTo],
        set: { score },
      });
  }

  async listMergeReviews(
    limit: number,
  ): Promise<{ eventId: EventId; similarTo: EventId; score: number; createdAt: Date }[]> {
    const rows = await this.db
      .select()
      .from(eventMergeReviews)
      .orderBy(desc(eventMergeReviews.score), asc(eventMergeReviews.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      eventId: asEventId(r.eventId),
      similarTo: asEventId(r.similarTo),
      score: r.score,
      createdAt: r.createdAt,
    }));
  }

  /** P1.10, ENGINEERING.md §10.4. See `EventMerge.mergeEvents` for the rules. */
  async mergeEvents(duplicateId: EventId, canonicalId: EventId): Promise<EventMergeOutcome> {
    if (duplicateId === canonicalId) {
      throw new ValidationError("An event can't be merged into itself.");
    }
    return this.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(events)
        .where(inArray(events.id, [duplicateId, canonicalId]))
        .orderBy(asc(events.id))
        .for("update");
      const dup = locked.find((r) => r.id === duplicateId);
      const canon = locked.find((r) => r.id === canonicalId);
      if (!dup || !canon) {
        const missing = [dup ? null : duplicateId, canon ? null : canonicalId];
        return { kind: "not_found", missing: missing.filter((x): x is EventId => x !== null) };
      }
      const blocked = await mergeBlocker(tx, duplicateId, canonicalId);
      if (blocked) return blocked;

      const duplicateFieldsWon = outranks(
        await sourcesOf(tx, duplicateId),
        await sourcesOf(tx, canonicalId),
      );
      const fields = mergeEventFields<EventFields>(
        fieldsOf(canon),
        withoutNulls(fieldsOf(dup)),
        duplicateFieldsWon,
      );
      const takeLineup =
        dup.lineupHash !== null && (duplicateFieldsWon || canon.lineupHash === null);
      if (takeLineup) await tx.delete(eventArtists).where(eq(eventArtists.eventId, canonicalId));
      const moved = await moveEventChildren(tx, duplicateId, canonicalId, takeLineup);
      await tx.delete(events).where(eq(events.id, duplicateId));
      // The dedupe key travels with the fields it is derived from; the duplicate's is free now.
      await tx
        .update(events)
        .set({
          ...fields,
          dedupeKey: duplicateFieldsWon ? dup.dedupeKey : canon.dedupeKey,
          lineupHash: takeLineup ? dup.lineupHash : canon.lineupHash,
          updatedAt: sql`now()`,
        })
        .where(eq(events.id, canonicalId));
      return { kind: "merged", duplicateFieldsWon, ...moved };
    });
  }
}

const fieldsOf = (e: EventRow): EventFields => ({
  title: e.title,
  type: e.type,
  status: e.status,
  startsAt: e.startsAt,
  startsAtDateOnly: e.startsAtDateOnly,
  endsAt: e.endsAt,
  genre: e.genre,
  imageUrl: e.imageUrl,
  venueId: e.venueId === null ? null : asVenueId(e.venueId),
});

/** A merge never blanks a field: the duplicate's nulls don't overwrite the canonical's values. */
const withoutNulls = (f: EventFields): Partial<EventFields> =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null)) as Partial<EventFields>;

async function sourcesOf(tx: Tx, id: EventId): Promise<EventSource[]> {
  const rows = await tx
    .select({ source: eventSources.source })
    .from(eventSources)
    .where(eq(eventSources.eventId, id));
  return rows.map((r) => r.source);
}

/** Strictly higher precedence (admin first, D-026/D-053); a tie keeps the canonical event's data. */
function outranks(dupSources: EventSource[], canonSources: EventSource[]): boolean {
  const d = topSource(dupSources);
  const c = topSource(canonSources);
  if (d === null) return false;
  return c === null || sourceRank(d) > sourceRank(c);
}

/** Conflicts a merge can't resolve on its own. Null when the merge may go ahead. */
async function mergeBlocker(
  tx: Tx,
  duplicateId: EventId,
  canonicalId: EventId,
): Promise<EventMergeOutcome | null> {
  const ids = [duplicateId, canonicalId];
  const shared = await tx
    .select({ eventId: sharedPlaylists.eventId })
    .from(sharedPlaylists)
    .where(inArray(sharedPlaylists.eventId, ids));
  if (shared.length === 2) return { kind: "both_have_shared_playlist" };
  const activeJobs = await tx
    .selectDistinct({ eventId: playlistJobs.eventId })
    .from(playlistJobs)
    .where(
      and(
        inArray(playlistJobs.eventId, ids),
        eq(playlistJobs.kind, "shared"),
        inArray(playlistJobs.status, ["queued", "running", "paused"]),
      ),
    );
  if (activeJobs.length === 2) return { kind: "both_have_active_shared_job" };
  const clashes = await tx.execute<{ user_id: string }>(sql`
    select distinct d.user_id from ${playlists} d
    join ${playlists} c on c.user_id = d.user_id and c.options_hash = d.options_hash
    where d.event_id = ${duplicateId} and c.event_id = ${canonicalId}`);
  const userIds = [...clashes].map((r) => r.user_id);
  return userIds.length > 0 ? { kind: "personal_playlist_conflict", userIds } : null;
}

/** Re-points everything that references the duplicate. Lineup rows move only when they win. */
async function moveEventChildren(
  tx: Tx,
  duplicateId: EventId,
  canonicalId: EventId,
  takeLineup: boolean,
): Promise<{ sourcesMoved: number; sharedPlaylistMoved: boolean; personalPlaylistsMoved: number }> {
  const to = { eventId: canonicalId };
  const sources = await tx
    .update(eventSources)
    .set(to)
    .where(eq(eventSources.eventId, duplicateId))
    .returning({ source: eventSources.source });
  if (takeLineup) {
    await tx.update(eventArtists).set(to).where(eq(eventArtists.eventId, duplicateId));
  }
  const shared = await tx
    .update(sharedPlaylists)
    .set(to)
    .where(eq(sharedPlaylists.eventId, duplicateId))
    .returning({ eventId: sharedPlaylists.eventId });
  const personal = await tx
    .update(playlists)
    .set(to)
    .where(eq(playlists.eventId, duplicateId))
    .returning({ id: playlists.id });
  await tx.update(playlistJobs).set(to).where(eq(playlistJobs.eventId, duplicateId));
  await tx
    .update(searchLog)
    .set({ clickedEventId: canonicalId })
    .where(eq(searchLog.clickedEventId, duplicateId));
  await tx
    .update(eventCandidates)
    .set({ publishedEventId: canonicalId })
    .where(eq(eventCandidates.publishedEventId, duplicateId));
  await mergeStats(tx, duplicateId, canonicalId);
  await retargetReviews(tx, duplicateId, canonicalId);
  return {
    sourcesMoved: sources.length,
    sharedPlaylistMoved: shared.length > 0,
    personalPlaylistsMoved: personal.length,
  };
}

/** Adds the duplicate's engagement counters to the canonical event's. */
async function mergeStats(tx: Tx, duplicateId: EventId, canonicalId: EventId): Promise<void> {
  await tx.execute(sql`
    insert into ${eventStats} (event_id, views, search_clicks, playlist_opens, trend_score, trend_updated_at)
    select ${canonicalId}, views, search_clicks, playlist_opens, trend_score, trend_updated_at
    from ${eventStats} where event_id = ${duplicateId}
    on conflict (event_id) do update set
      views = ${eventStats}.views + excluded.views,
      search_clicks = ${eventStats}.search_clicks + excluded.search_clicks,
      playlist_opens = ${eventStats}.playlist_opens + excluded.playlist_opens,
      trend_score = ${eventStats}.trend_score + excluded.trend_score,
      trend_updated_at = greatest(${eventStats}.trend_updated_at, excluded.trend_updated_at)`);
}

/** Reviews pairing the duplicate with a third event now pair the canonical one; the merged pair is resolved. */
async function retargetReviews(tx: Tx, duplicateId: EventId, canonicalId: EventId): Promise<void> {
  await tx.execute(sql`
    insert into ${eventMergeReviews} (event_id, similar_to, score, created_at)
    select
      case when event_id = ${duplicateId} then ${canonicalId}::uuid else event_id end,
      case when similar_to = ${duplicateId} then ${canonicalId}::uuid else similar_to end,
      score, created_at
    from ${eventMergeReviews}
    where (event_id = ${duplicateId} or similar_to = ${duplicateId})
      and event_id <> ${canonicalId} and similar_to <> ${canonicalId}
    on conflict (event_id, similar_to) do nothing`);
  await tx
    .delete(eventMergeReviews)
    .where(
      or(eq(eventMergeReviews.eventId, duplicateId), eq(eventMergeReviews.similarTo, duplicateId)),
    );
}

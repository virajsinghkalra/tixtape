/** Admin console read model and job cancel in Postgres (P3.5). */
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { AdminConsoleStore, AdminJob, CancelOutcome } from "@/application/admin/ports";
import { ACTIVE_JOB_STATUSES, JOB_STATUSES, type JobStatus } from "@/application/ports/playlists";
import type { Database } from "@/db/client";
import { artists, events, ingestRuns, playlistJobs } from "@/db/schema";
import { EVENT_VISIBILITIES, type EventVisibility } from "@/domain/events/visibility";
import { asEventId, asPlaylistJobId, type EventId, type PlaylistJobId } from "@/domain/shared/ids";

function tally<K extends string>(keys: readonly K[], rows: { key: K; n: number }[]) {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const r of rows) out[r.key] = r.n;
  return out;
}

export class PgAdminConsoleRepository implements AdminConsoleStore {
  constructor(private readonly db: Database) {}

  async countEventsByVisibility(): Promise<Record<EventVisibility, number>> {
    const rows = await this.db
      .select({ key: events.visibility, n: count() })
      .from(events)
      .groupBy(events.visibility);
    return tally(EVENT_VISIBILITIES, rows);
  }

  async countArtistsNeedingReview(): Promise<number> {
    const rows = await this.db
      .select({ n: count() })
      .from(artists)
      .where(eq(artists.matchStatus, "needs_review"));
    return rows[0]?.n ?? 0;
  }

  async countJobsByStatus(): Promise<Record<JobStatus, number>> {
    const rows = await this.db
      .select({ key: playlistJobs.status, n: count() })
      .from(playlistJobs)
      .groupBy(playlistJobs.status);
    return tally(JOB_STATUSES, rows);
  }

  async latestIngestRuns() {
    // Newest run per source: DISTINCT ON keeps the first row of each source in this order.
    const rows = await this.db
      .selectDistinctOn([ingestRuns.source])
      .from(ingestRuns)
      .orderBy(ingestRuns.source, desc(ingestRuns.startedAt));
    // The enum orders by declaration, not name; the dashboard lists sources alphabetically.
    rows.sort((a, b) => a.source.localeCompare(b.source));
    return rows.map((r) => ({
      source: r.source,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      itemsSeen: r.itemsSeen,
      itemsNew: r.itemsNew,
      error: r.error,
    }));
  }

  async listJobs(filter: {
    statuses: readonly JobStatus[] | null;
    limit: number;
  }): Promise<AdminJob[]> {
    const rows = await this.db
      .select({ job: playlistJobs, eventTitle: events.title })
      .from(playlistJobs)
      .innerJoin(events, eq(events.id, playlistJobs.eventId))
      .where(filter.statuses ? inArray(playlistJobs.status, [...filter.statuses]) : undefined)
      .orderBy(desc(playlistJobs.createdAt), desc(playlistJobs.id))
      .limit(filter.limit);
    return rows.map(({ job, eventTitle }) => ({
      id: asPlaylistJobId(job.id),
      eventId: asEventId(job.eventId),
      eventTitle,
      kind: job.kind,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      artistsDone: job.artistsDone,
      artistsTotal: job.artistsTotal,
      error: job.error,
      resumeAfter: job.resumeAfter,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }));
  }

  async findEventVerification(id: EventId): Promise<unknown> {
    const rows = await this.db
      .select({ verification: events.verification })
      .from(events)
      .where(eq(events.id, id));
    return rows[0] ? (rows[0].verification ?? null) : undefined;
  }

  async failActiveJob(id: PlaylistJobId, error: string): Promise<CancelOutcome> {
    const updated = await this.db
      .update(playlistJobs)
      .set({
        status: "failed",
        error,
        lockedUntil: null,
        resumeAfter: null,
        updatedAt: sql`now()`,
      })
      .where(and(eq(playlistJobs.id, id), inArray(playlistJobs.status, [...ACTIVE_JOB_STATUSES])))
      .returning({ id: playlistJobs.id });
    if (updated.length > 0) return "cancelled";
    const exists = await this.db
      .select({ id: playlistJobs.id })
      .from(playlistJobs)
      .where(eq(playlistJobs.id, id));
    return exists.length > 0 ? "not_active" : "not_found";
  }
}

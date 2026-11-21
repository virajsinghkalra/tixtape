/** Shared playlist jobs in Postgres, the job queue (D-005, D-036). */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import {
  ACTIVE_JOB_STATUSES,
  BUILD_STAGES,
  JobCheckpointSchema,
  type BuildStage,
  type JobLease,
  type JobUpdate,
  type PlaylistJob,
  type PlaylistJobRepository,
} from "@/application/ports/playlists";
import type { Database } from "@/db/client";
import { playlistJobs } from "@/db/schema";
import { asEventId, asPlaylistJobId, type EventId, type PlaylistJobId } from "@/domain/shared/ids";

type JobRow = typeof playlistJobs.$inferSelect;

/** Bumped when the selection rules change in a way that should rebuild playlists. */
const SHARED_JOB_OPTIONS = { optionsVersion: 1 };

const isStage = (s: string | null): s is BuildStage =>
  s !== null && (BUILD_STAGES as readonly string[]).includes(s);

function toJob(row: JobRow): PlaylistJob {
  // A checkpoint that no longer parses (older format) restarts the build; the playlist
  // itself is found again through shared_playlists, so nothing is duplicated.
  const checkpoint = row.checkpoint === null ? null : JobCheckpointSchema.safeParse(row.checkpoint);
  return {
    id: asPlaylistJobId(row.id),
    eventId: asEventId(row.eventId),
    status: row.status,
    stage: isStage(row.stage) ? row.stage : null,
    progress: row.progress,
    artistsDone: row.artistsDone,
    artistsTotal: row.artistsTotal,
    checkpoint: checkpoint?.success ? checkpoint.data : null,
    resumeAfter: row.resumeAfter,
    error: row.error,
  };
}

const active = inArray(playlistJobs.status, [...ACTIVE_JOB_STATUSES]);

export class PgPlaylistJobRepository implements PlaylistJobRepository {
  constructor(private readonly db: Database) {}

  async findById(id: PlaylistJobId): Promise<PlaylistJob | null> {
    const rows = await this.db.select().from(playlistJobs).where(eq(playlistJobs.id, id));
    return rows[0] ? toJob(rows[0]) : null;
  }

  async findActiveShared(eventId: EventId): Promise<PlaylistJob | null> {
    const rows = await this.db
      .select()
      .from(playlistJobs)
      .where(and(eq(playlistJobs.eventId, eventId), eq(playlistJobs.kind, "shared"), active));
    return rows[0] ? toJob(rows[0]) : null;
  }

  /** The partial unique index `playlist_jobs_one_active_shared_uq` turns a race into a no-op. */
  async createShared(eventId: EventId): Promise<PlaylistJob | null> {
    const rows = await this.db
      .insert(playlistJobs)
      .values({
        idempotencyKey: `shared:${eventId}:${randomUUID()}`,
        kind: "shared",
        eventId,
        options: SHARED_JOB_OPTIONS,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toJob(rows[0]) : null;
  }

  async claim(
    id: PlaylistJobId,
    leaseMs: number,
  ): Promise<{ job: PlaylistJob; lease: JobLease } | null> {
    // Millisecond precision so the lease round-trips exactly through a JS Date.
    const rows = await this.db
      .update(playlistJobs)
      .set({
        lockedUntil: sql`date_trunc('milliseconds', now()) + ${leaseMs} * interval '1 millisecond'`,
      })
      .where(
        and(
          eq(playlistJobs.id, id),
          active,
          or(isNull(playlistJobs.lockedUntil), lt(playlistJobs.lockedUntil, sql`now()`)),
        ),
      )
      .returning();
    const row = rows[0];
    if (!row?.lockedUntil) return null;
    return { job: toJob(row), lease: { jobId: id, lockedUntil: row.lockedUntil } };
  }

  async save(lease: JobLease, update: JobUpdate): Promise<boolean> {
    const rows = await this.db
      .update(playlistJobs)
      .set({ ...update, updatedAt: sql`now()` })
      .where(held(lease))
      .returning({ id: playlistJobs.id });
    return rows.length > 0;
  }

  async release(lease: JobLease): Promise<void> {
    await this.db.update(playlistJobs).set({ lockedUntil: null }).where(ours(lease));
  }

  /**
   * For the scheduled sweep (D-005, D-043): active shared jobs whose `resume_after` has passed,
   * not leased, and untouched for `DUE_IDLE_MS` (a tab that stepped recently is still driving
   * the job). Oldest first.
   */
  async listDue(now: Date, limit: number): Promise<PlaylistJob[]> {
    const rows = await this.db
      .select()
      .from(playlistJobs)
      .where(
        and(
          eq(playlistJobs.kind, "shared"),
          active,
          or(isNull(playlistJobs.resumeAfter), lte(playlistJobs.resumeAfter, now)),
          or(isNull(playlistJobs.lockedUntil), lt(playlistJobs.lockedUntil, now)),
          lt(playlistJobs.updatedAt, new Date(now.getTime() - DUE_IDLE_MS)),
        ),
      )
      .orderBy(asc(playlistJobs.updatedAt))
      .limit(limit);
    return rows.map(toJob);
  }
}

/** A job stepped within this window is still being driven by a browser tab. */
export const DUE_IDLE_MS = 2 * 60_000;

/**
 * The lease is ours and the job is still active: a finished or cancelled job (status set by
 * another step or by an admin) is never written to again, so it can't be revived.
 */
const ours = (lease: JobLease) =>
  and(eq(playlistJobs.id, lease.jobId), eq(playlistJobs.lockedUntil, lease.lockedUntil));
const held = (lease: JobLease) => and(ours(lease), active);

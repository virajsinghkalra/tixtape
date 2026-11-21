/**
 * Read model and job control for the admin console (P3.5). Implemented in
 * src/infrastructure/db/admin-console-repository.ts.
 */
import type { JobStatus } from "@/application/ports/playlists";
import type { EventVisibility } from "@/domain/events/visibility";
import type { EventId, PlaylistJobId } from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";

export type IngestRunSummary = {
  source: EventSource;
  status: "running" | "succeeded" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  itemsSeen: number;
  itemsNew: number;
  error: string | null;
};

export type AdminJob = {
  id: PlaylistJobId;
  eventId: EventId;
  eventTitle: string;
  kind: "shared" | "personal";
  status: JobStatus;
  stage: string | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
  error: string | null;
  resumeAfter: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CancelOutcome = "cancelled" | "not_active" | "not_found";

export interface AdminConsoleStore {
  countEventsByVisibility(): Promise<Record<EventVisibility, number>>;
  countArtistsNeedingReview(): Promise<number>;
  countJobsByStatus(): Promise<Record<JobStatus, number>>;
  /** The newest run of each source that has ever run, by source name. */
  latestIngestRuns(): Promise<IngestRunSummary[]>;
  /** Newest first. */
  listJobs(filter: { statuses: readonly JobStatus[] | null; limit: number }): Promise<AdminJob[]>;
  /** The raw `events.verification` jsonb (null when never verified); undefined: no such event. */
  findEventVerification(id: EventId): Promise<unknown>;
  /**
   * Sets an active job (queued, running, paused) to `failed` with `error`, clears its lease
   * and resume time. A step that still holds the old lease can't write again (its save checks
   * the job is active), so the job stays stopped.
   */
  failActiveJob(id: PlaylistJobId, error: string): Promise<CancelOutcome>;
}

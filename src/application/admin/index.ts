/**
 * Admin console use cases (P3.5): dashboard counts, the jobs list, job cancel and the stored
 * verification of an event. Routes and pages reach this through src/server/admin-console.ts.
 */
import { ACTIVE_JOB_STATUSES, type JobStatus } from "@/application/ports/playlists";
import type { EventVisibility } from "@/domain/events/visibility";
import type { EventId, PlaylistJobId } from "@/domain/shared/ids";
import { cancelPlaylistJob, type CancelJobInput } from "./cancel-playlist-job";
import type { AdminConsoleStore, AdminJob, IngestRunSummary } from "./ports";
import { readVerification, type VerificationView } from "./verification";

export type { AdminConsoleStore, AdminJob, CancelOutcome, IngestRunSummary } from "./ports";
export {
  CancelJobInputSchema,
  DEFAULT_CANCEL_REASON,
  type CancelJobInput,
} from "./cancel-playlist-job";
export type { StoredFieldVerification, StoredVerification, VerificationView } from "./verification";

export const JOB_FILTERS = ["active", "failed", "all"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

const FILTER_STATUSES: Record<JobFilter, readonly JobStatus[] | null> = {
  active: ACTIVE_JOB_STATUSES,
  failed: ["failed", "partial"],
  all: null,
};

export type AdminDashboard = {
  events: Record<EventVisibility, number>;
  artistsNeedingReview: number;
  jobs: Record<JobStatus, number>;
  ingestRuns: IngestRunSummary[];
};

export type AdminConsole = {
  dashboard(): Promise<AdminDashboard>;
  listJobs(filter: JobFilter, limit: number): Promise<AdminJob[]>;
  /** Undefined when there's no such event. */
  eventVerification(id: EventId): Promise<VerificationView | undefined>;
  /** Throws `NotFoundError` / `ConflictError`. */
  cancelJob(
    id: PlaylistJobId,
    input: CancelJobInput,
  ): Promise<{ jobId: PlaylistJobId; status: "failed"; error: string }>;
};

export function createAdminConsole(store: AdminConsoleStore): AdminConsole {
  return {
    dashboard: async () => {
      const [events, artistsNeedingReview, jobs, ingestRuns] = await Promise.all([
        store.countEventsByVisibility(),
        store.countArtistsNeedingReview(),
        store.countJobsByStatus(),
        store.latestIngestRuns(),
      ]);
      return { events, artistsNeedingReview, jobs, ingestRuns };
    },
    listJobs: (filter, limit) => store.listJobs({ statuses: FILTER_STATUSES[filter], limit }),
    eventVerification: async (id) => {
      const raw = await store.findEventVerification(id);
      return raw === undefined ? undefined : readVerification(raw);
    },
    cancelJob: (id, input) => cancelPlaylistJob(store, id, input),
  };
}

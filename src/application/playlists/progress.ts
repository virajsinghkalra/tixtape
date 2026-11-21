/** The progress shape returned by step and status calls (P2.2). */
import type {
  BuildStage,
  JobCheckpoint,
  JobStatus,
  PlaylistJob,
} from "@/application/ports/playlists";
import type { PlaylistJobId } from "@/domain/shared/ids";

export type BuildProgress = {
  jobId: PlaylistJobId;
  status: JobStatus;
  stage: BuildStage | null;
  /** 0–100. */
  progress: number;
  artistsDone: number;
  artistsTotal: number;
  /** Lineup artists that got no songs (not on Spotify, or nothing found). */
  unresolved: string[];
  /** When Spotify asked us to wait: step again after this time. */
  resumeAfter?: Date;
  /** Set once the playlist is complete. */
  playlistUrl?: string;
  /** Set when the job failed. Safe to show to users. */
  error?: string;
};

/** Spotify accepts at most 100 items per request. */
export const CHUNK_SIZE = 100;

const FINISHED: readonly JobStatus[] = ["succeeded", "partial"];

/** Selection is most of the work (5–80%), creating 82%, writing 85–99%, done 100%. */
export function progressFor(cp: JobCheckpoint, artistsTotal: number): number {
  switch (cp.stage) {
    case "select":
      return 5 + Math.floor((75 * cp.artistIndex) / Math.max(artistsTotal, 1));
    case "create":
      return 82;
    case "write": {
      const chunks = Math.max(Math.ceil(cp.pickedTrackIds.length / CHUNK_SIZE), 1);
      return 85 + Math.floor((14 * cp.chunksDone) / chunks);
    }
    case "done":
      return 100;
  }
}

export function toProgress(job: PlaylistJob): BuildProgress {
  const cp = job.checkpoint;
  const active = job.status === "running" || job.status === "paused" || job.status === "queued";
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    artistsDone: job.artistsDone,
    artistsTotal: job.artistsTotal,
    unresolved: cp?.unresolved ?? [],
    ...(active && job.resumeAfter ? { resumeAfter: job.resumeAfter } : {}),
    ...(FINISHED.includes(job.status) && cp?.playlistUrl ? { playlistUrl: cp.playlistUrl } : {}),
    ...(job.status === "failed" && job.error ? { error: job.error } : {}),
  };
}

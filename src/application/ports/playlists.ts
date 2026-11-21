/**
 * Shared playlist persistence (P2.2–P2.5, D-036, D-037). Implemented in src/infrastructure/db/.
 */
import { z } from "zod";
import type { PickedTrack } from "@/domain/playlists/selection";
import type { EventDetail } from "./events";
import {
  asSpotifyArtistId,
  asSpotifyPlaylistId,
  asSpotifyTrackId,
  type EventId,
  type PlaylistJobId,
  type SpotifyPlaylistId,
  type UserId,
} from "@/domain/shared/ids";

export const JOB_STATUSES = [
  "queued",
  "running",
  "paused",
  "succeeded",
  "partial",
  "failed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "paused"];

export const BUILD_STAGES = ["select", "create", "write", "done"] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

const trackId = z.string().min(1).transform(asSpotifyTrackId);
const picked = z.object({ id: trackId, isrc: z.string().nullable(), key: z.string() });

const poolTrack = z.object({
  id: trackId,
  name: z.string(),
  artistIds: z.array(z.string().transform(asSpotifyArtistId)),
  isrc: z.string().nullable(),
  durationMs: z.number().int().min(0),
});
export type PoolTrack = z.infer<typeof poolTrack>;

/** POOL_PHASES run in order, one unit of work each (several units for map and albums). */
export const POOL_PHASES = ["signals", "newest", "map", "albums", "ready"] as const;

/** The current artist's candidate songs while they're being gathered (D-065). */
export const ArtistPoolSchema = z.object({
  phase: z.enum(POOL_PHASES),
  search: z.array(poolTrack),
  mostListened: z.array(poolTrack),
  trending: z.array(poolTrack),
  newest: z.array(poolTrack),
  albums: z.array(poolTrack),
  /** Signal titles still to map to Spotify, best first. */
  toMap: z.array(z.object({ title: z.string(), signal: z.enum(["mostListened", "trending"]) })),
  /** Album and single ids, newest first, still to open. Null until listed. */
  albumIds: z.array(z.string()).nullable(),
});
export type ArtistPool = z.infer<typeof ArtistPoolSchema>;

/** Validated when read back from `playlist_jobs.checkpoint` (ENGINEERING.md §3). */
export const JobCheckpointSchema = z.object({
  stage: z.enum(BUILD_STAGES),
  /** The lineup this build is for; a different current hash restarts selection. */
  lineupHash: z.string().nullable(),
  /** Next matched artist to select songs for. */
  artistIndex: z.number().int().min(0),
  /** Songs picked per matched artist, in artist order. */
  picks: z.array(z.array(picked)),
  /** Names of lineup artists that got no songs (unmatched on Spotify, or nothing found). */
  unresolved: z.array(z.string()),
  /** The final ordered playlist (D-040), set when selection finishes. */
  pickedTrackIds: z.array(trackId),
  playlistId: z.string().min(1).transform(asSpotifyPlaylistId).nullable(),
  playlistUrl: z.string().nullable(),
  chunksDone: z.number().int().min(0),
  /** Set just before a chunk is sent; still set on resume means the step died mid-chunk. */
  chunkInFlight: z.number().int().min(0).nullable(),
  snapshotId: z.string().nullable(),
  /** D-065: Last.fm listeners per matched artist (null = unknown), gathered first. */
  popularity: z.array(z.number().nullable()).default([]),
  /** The pool of the artist at `artistIndex`, while it's being gathered. */
  pool: ArtistPoolSchema.nullable().default(null),
});
export type JobCheckpoint = z.infer<typeof JobCheckpointSchema>;
export type { PickedTrack };

export type PlaylistJob = {
  id: PlaylistJobId;
  eventId: EventId;
  status: JobStatus;
  stage: BuildStage | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
  checkpoint: JobCheckpoint | null;
  resumeAfter: Date | null;
  error: string | null;
};

export type JobUpdate = Partial<
  Pick<
    PlaylistJob,
    | "status"
    | "stage"
    | "progress"
    | "artistsDone"
    | "artistsTotal"
    | "checkpoint"
    | "resumeAfter"
    | "error"
  >
>;

/** Proof that a step holds the job: the `locked_until` it set when claiming. */
export type JobLease = { jobId: PlaylistJobId; lockedUntil: Date };

export interface PlaylistJobRepository {
  findById(id: PlaylistJobId): Promise<PlaylistJob | null>;
  /** The queued, running or paused shared job for this event, if any. */
  findActiveShared(eventId: EventId): Promise<PlaylistJob | null>;
  /**
   * Inserts a queued shared job. Returns null when another active shared job exists for the
   * event (the partial unique index, D-036).
   */
  createShared(eventId: EventId): Promise<PlaylistJob | null>;
  /**
   * `UPDATE … SET locked_until = now() + leaseMs WHERE id = $1 AND status is active AND
   * (locked_until IS NULL OR locked_until < now()) RETURNING`. Null when another step holds the
   * lease, or the job is finished or missing.
   */
  claim(id: PlaylistJobId, leaseMs: number): Promise<{ job: PlaylistJob; lease: JobLease } | null>;
  /** Writes only while `lease` is still held. False means the lease was lost: stop working. */
  save(lease: JobLease, update: JobUpdate): Promise<boolean>;
  /** Clears `locked_until` if `lease` still holds it, so the next step can start right away. */
  release(lease: JobLease): Promise<void>;
  /**
   * For the scheduled sweep (D-005): active shared jobs whose `resume_after` has passed, not
   * leased, and not stepped recently (a tab is still driving those). Oldest first.
   */
  listDue(now: Date, limit: number): Promise<PlaylistJob[]>;
}

export type SharedPlaylist = {
  eventId: EventId;
  spotifyPlaylistId: SpotifyPlaylistId;
  url: string;
  trackIds: string[];
  snapshotId: string | null;
  /** Null until the first build completes. */
  lineupHashAtBuild: string | null;
  builtAt: Date;
};

export interface SharedPlaylistRepository {
  findByEvent(eventId: EventId): Promise<SharedPlaylist | null>;
  /**
   * Records a just-created Spotify playlist (before any items are added). If the event already
   * has one, the existing row wins and is returned unchanged.
   */
  saveCreated(
    eventId: EventId,
    playlist: { spotifyPlaylistId: SpotifyPlaylistId; url: string },
  ): Promise<SharedPlaylist>;
  markBuilt(
    eventId: EventId,
    build: { trackIds: string[]; snapshotId: string | null; lineupHash: string | null; at: Date },
  ): Promise<void>;
}

export type PublisherRecord = { userId: UserId; connectedAt: Date };

/** The single `spotify_publisher` row (D-036). */
export interface PublisherRepository {
  find(): Promise<PublisherRecord | null>;
  /** Upserts the single row. */
  set(userId: UserId, at: Date): Promise<void>;
}

/** The event read the engine needs (served by the Events module's `getEvent`). */
export interface EventLineupReader {
  /**
   * Throws `NotFoundError` for an unknown event. `verification` may carry verified daily
   * `hours` (D-065, e.g. "14:00-22:00 IST each day"); it's parsed defensively.
   */
  getEvent(id: EventId): Promise<EventDetail & { verification?: unknown }>;
}

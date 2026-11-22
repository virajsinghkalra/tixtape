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
  type ArtistId,
  type EventId,
  type PlaylistJobId,
  type SpotifyArtistId,
  type SpotifyPlaylistId,
  type SpotifyTrackId,
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
  /** The artist being resolved and how far it got (8-song fix): the next step continues it. */
  resolving: z
    .object({
      artistIndex: z.number().int().min(0),
      state: z.object({
        pages: z.number().int().min(0),
        lastPageNew: z.number().int(),
        exhausted: z.boolean(),
        calls: z.number().int().min(0),
        found: z.array(
          z.object({
            id: trackId,
            name: z.string(),
            artistIds: z.array(z.string().transform(asSpotifyArtistId)),
            isrc: z.string().nullable(),
            durationMs: z.number().int().min(0),
            releaseDate: z.string().nullable(),
          }),
        ),
        albumIds: z.array(z.string()).nullable(),
        targeted: z.array(z.string()),
      }),
    })
    .optional(),
  /** Older checkpoints (before D-080) carried these; they're ignored now. */
  popularity: z.unknown().optional(),
  pool: z.unknown().optional(),
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
  /**
   * D-085: the selection algorithm version it was built with. The table column defaults to 1
   * (built before D-065); a store that doesn't report it is taken as current.
   */
  optionsVersion?: number;
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
    build: {
      trackIds: string[];
      snapshotId: string | null;
      lineupHash: string | null;
      at: Date;
      /** D-085: defaults to 1 for callers that don't pass it. */
      optionsVersion?: number;
    },
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

/** One resolved candidate song for an artist (D-080), shared by every event and rebuild. */
export type CachedSong = {
  id: SpotifyTrackId;
  name: string;
  artistIds: SpotifyArtistId[];
  isrc: string | null;
  durationMs: number;
  releaseDate: string | null;
  /** 0-based position in Spotify's `artist:"…"` search results (popularity proxy). */
  searchRank: number;
  /** 1-based Last.fm top-track rank of this title, or null. */
  lastfmRank: number | null;
  /** D-085: 0–1 scores from other providers (e.g. `setlistfm`), when they list this song. */
  providerScores?: Partial<Record<"setlistfm", number>>;
};

export type ArtistSongs = {
  /** The Spotify artist these songs were resolved for; a re-matched artist is a cache miss. */
  spotifyArtistId: SpotifyArtistId;
  songs: CachedSong[];
  /** Last.fm listeners (D-065 popularity), null when unknown. */
  listeners: number | null;
  /**
   * D-085: providers consulted for this artist (`known` = they had data). An entry missing a
   * provider is enriched in place, without Spotify calls.
   */
  providers?: Partial<Record<"setlistfm", { known: boolean }>>;
  /** Search pages fetched; more can be fetched for a bigger budget unless `exhausted`. */
  pages: number;
  /** Spotify had no more results for the artist. */
  exhausted: boolean;
  /**
   * The song budget this pool was resolved for (8-song fix). Missing on entries written before
   * it, which may be truncated and are resolved again.
   */
  resolvedFor?: number;
  fetchedAt: Date;
};

/** D-080: resolved songs per artist (`artist_track_cache`, TTL enforced by callers). */
export interface ArtistSongsCache {
  getMany(artistIds: readonly ArtistId[], market: string): Promise<Map<ArtistId, ArtistSongs>>;
  put(artistId: ArtistId, market: string, songs: ArtistSongs): Promise<void>;
}

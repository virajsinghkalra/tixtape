/**
 * Playlist Engine use cases (P2.1–P2.5). Infrastructure builds the ports
 * (src/infrastructure/playlists-module.ts); routes reach this through src/server/playlists.ts.
 */
import { z } from "zod";
import type { Clock } from "@/application/ports/clock";
import {
  asPlaylistJobId,
  type EventId,
  type PlaylistJobId,
  type UserId,
} from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import type { Result } from "@/lib/result";
import type { ArtistPopularitySource, NewReleaseSource } from "@/application/ports/music-signals";
import type { ArtistSongsCache } from "@/application/ports/playlists";
import { entryFor } from "./artist-songs";
import { MemoryArtistSongsCache } from "./memory-songs-cache";
import { currentProgress, stepBuild, type BuildDeps } from "./build-step";
import { estimateFromPlan, planBuild, type PlaylistPreview } from "./plan";
import { buildReadiness, prewarmEvent, type BuildReadiness, type PrewarmResult } from "./prewarm";
import type { BuildProgress } from "./progress";
import {
  getPublisher,
  getPublisherStatus,
  setPublisher,
  unavailableAlert,
  type PublisherProblem,
  type PublisherStatus,
} from "./publisher";
import {
  getSharedStatus,
  startSharedBuild,
  type SharedPlaylistStatus,
  type StartResult,
} from "./shared-builds";
import { FixedWindowLimiter, type StartLimiter } from "./start-limiter";

export type { BuildProgress } from "./progress";
export type { PlaylistPreview } from "./plan";
export type { BuildReadiness, PrewarmResult } from "./prewarm";
export type { PublisherProblem, PublisherStatus } from "./publisher";
export type { SharedPlaylistStatus, StartResult } from "./shared-builds";
export type { StartLimiter } from "./start-limiter";
export { NoMatchedArtistsError, PlaylistUnavailableError, UNAVAILABLE_MESSAGE } from "./errors";
export {
  LEASE_MS,
  REQUEST_TIMEOUT_MS,
  SHORT_PAUSE_MS,
  STEP_BUDGET_MS,
  UNIT_START_LIMIT_MS,
  WRITE_LEASE_MARGIN_MS,
} from "./build-step";

/** Default abuse limit (D-036): 10 build starts per client IP per hour, per process. */
export const STARTS_PER_HOUR = 10;

export type PlaylistsUseCases = {
  /** `{status:"ready", url}` when current, else `{status:"building", jobId}`. */
  startSharedBuild(eventId: EventId, clientKey: string): Promise<StartResult>;
  /** Does up to ~8 s of work. Throws `NotFoundError` for an unknown job. */
  step(jobId: PlaylistJobId): Promise<BuildProgress>;
  /** Progress without doing any work. Throws `NotFoundError`. */
  getProgress(jobId: PlaylistJobId): Promise<BuildProgress>;
  getSharedStatus(eventId: EventId): Promise<SharedPlaylistStatus>;
  getPublisher(): Promise<Result<{ userId: UserId }, PublisherProblem>>;
  getPublisherStatus(): Promise<PublisherStatus>;
  /** Throws `ConflictError` when the user's Spotify tokens are missing or need reauth. */
  setPublisher(userId: UserId): Promise<PublisherStatus>;
  /**
   * D-065 preview: `{songs, minutes, perTier, showMinutes, days, unmatched}` from the same plan
   * the build fills. Uses only popularity already cached (no Last.fm calls on page views), so
   * the tier split can shift slightly once a build has looked popularity up.
   * Throws `NotFoundError`.
   */
  estimatePlaylist(eventId: EventId): Promise<PlaylistPreview & { readiness: BuildReadiness }>;
  /**
   * D-080: resolves the event's uncached artists into the shared song cache until `deadline`.
   * Run it as the `prewarm` Spotify class. Throws `NotFoundError` for unpublished events.
   */
  prewarmEvent(eventId: EventId, opts: { deadline: Date }): Promise<PrewarmResult>;
};

export type PlaylistsPorts = Omit<BuildDeps, "alertUnavailable" | "popularity" | "songsCache"> & {
  clock: Clock;
  limiter?: StartLimiter;
  /** D-065. Without it every artist's popularity is unknown (factor 1.0: tier decides). */
  popularity?: ArtistPopularitySource;
  /** D-080: shared resolved songs. Defaults to a per-process memory cache (tests). */
  songsCache?: ArtistSongsCache;
  /** No longer used (D-080 replaced album-by-album newest releases); kept for old callers. */
  newReleases?: NewReleaseSource;
};

const unknownPopularity: ArtistPopularitySource = { listeners: async () => null };

export function createPlaylistsUseCases(ports: PlaylistsPorts): PlaylistsUseCases {
  const limiter =
    ports.limiter ?? new FixedWindowLimiter(STARTS_PER_HOUR, 60 * 60 * 1000, ports.clock);
  const deps = {
    ...ports,
    limiter,
    popularity: ports.popularity ?? unknownPopularity,
    songsCache: ports.songsCache ?? new MemoryArtistSongsCache(),
    alertUnavailable: unavailableAlert(ports.logger, ports.clock),
  };
  return {
    startSharedBuild: (eventId, clientKey) => startSharedBuild(deps, eventId, clientKey),
    step: (jobId) => stepBuild(deps, jobId),
    getProgress: (jobId) => currentProgress(deps, jobId),
    getSharedStatus: (eventId) => getSharedStatus(deps, eventId),
    getPublisher: () => getPublisher(deps),
    getPublisherStatus: () => getPublisherStatus(deps),
    setPublisher: (userId) => setPublisher(deps, userId),
    estimatePlaylist: async (eventId) => {
      const plan = planBuild(await deps.events.getEvent(eventId));
      // Popularity the song cache already holds (D-080), else what Last.fm has in memory.
      const cache = await deps.songsCache.getMany(
        plan.artists.map((a) => a.artistId),
        plan.market,
      );
      const popularity = await Promise.all(
        plan.artists.map(
          async (a) =>
            entryFor(cache, a)?.listeners ??
            (await deps.popularity.listeners(a.name, { cachedOnly: true }).catch(() => null)),
        ),
      );
      return { ...estimateFromPlan(plan, popularity), readiness: await buildReadiness(deps, plan) };
    },
    prewarmEvent: (eventId, opts) => prewarmEvent(deps, eventId, opts),
  };
}

/** Route parameter → job id; anything that isn't a UUID is simply not found. */
export function parseJobId(raw: string): PlaylistJobId {
  if (!z.uuid().safeParse(raw).success) throw new NotFoundError("That playlist job doesn't exist.");
  return asPlaylistJobId(raw);
}

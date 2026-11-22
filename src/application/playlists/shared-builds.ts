/** Starting a shared build and reading an event's playlist status (P2.2, P2.4, D-036). */
import type { EventDetail } from "@/application/ports/events";
import type {
  EventLineupReader,
  PlaylistJob,
  PlaylistJobRepository,
  SharedPlaylist,
  SharedPlaylistRepository,
} from "@/application/ports/playlists";
import type { EventId, PlaylistJobId } from "@/domain/shared/ids";
import { ConflictError, RateLimitedError } from "@/lib/errors";
import { PLAYLIST_ALGORITHM_VERSION } from "./build-step";
import { NoMatchedArtistsError, PlaylistUnavailableError } from "./errors";
import { getPublisher, type PublisherDeps, type PublisherProblem } from "./publisher";
import type { StartLimiter } from "./start-limiter";

export type SharedBuildDeps = PublisherDeps & {
  jobs: PlaylistJobRepository;
  shared: SharedPlaylistRepository;
  events: EventLineupReader;
  limiter: StartLimiter;
  alertUnavailable: (problem: PublisherProblem) => void;
};

export type StartResult =
  { status: "ready"; url: string } | { status: "building"; jobId: PlaylistJobId };

export type SharedPlaylistStatus =
  | { status: "none" }
  | { status: "building"; jobId: PlaylistJobId; url?: string }
  | { status: "ready"; url: string; builtAt: Date; stale: boolean };

/** Built at least once (the first build completed). */
const isBuilt = (row: SharedPlaylist | null): row is SharedPlaylist =>
  row !== null && row.lineupHashAtBuild !== null;

/** D-085: built for this lineup by the current algorithm (an older version is stale). */
const isCurrent = (row: SharedPlaylist | null, event: EventDetail): row is SharedPlaylist =>
  isBuilt(row) &&
  row.lineupHashAtBuild === event.lineupHash &&
  (row.optionsVersion ?? PLAYLIST_ALGORITHM_VERSION) >= PLAYLIST_ALGORITHM_VERSION;

const building = (job: PlaylistJob): StartResult => ({ status: "building", jobId: job.id });

/**
 * Returns the playlist when it matches the current lineup. Otherwise joins the event's active
 * build, or starts one (rate limited per `clientKey`). Throws `NotFoundError`,
 * `NoMatchedArtistsError`, `PlaylistUnavailableError`, `RateLimitedError`.
 */
export async function startSharedBuild(
  deps: SharedBuildDeps,
  eventId: EventId,
  clientKey: string,
): Promise<StartResult> {
  const event = await deps.events.getEvent(eventId);
  const row = await deps.shared.findByEvent(eventId);
  const stored = row;
  if (isCurrent(row, event)) return { status: "ready", url: row.url };
  // D-070: an event that has happened keeps its playlist but never starts a new build.
  if (event.archived) {
    if (stored) return { status: "ready", url: stored.url };
    throw new ConflictError("This event has already happened, so there's no playlist to make.");
  }

  const active = await deps.jobs.findActiveShared(eventId);
  if (active) return building(active);

  if (!event.lineup.some((a) => a.spotifyId !== null)) throw new NoMatchedArtistsError();
  const publisher = await getPublisher(deps);
  if (!publisher.ok) {
    deps.alertUnavailable(publisher.error);
    throw new PlaylistUnavailableError();
  }
  if (!(await deps.limiter.tryTake(clientKey))) {
    throw new RateLimitedError(
      "Too many playlists started from here. Try again later.",
      deps.limiter.retryAfterSeconds(clientKey),
    );
  }

  // The partial unique index allows one active build per event: on a race, join the winner.
  const job =
    (await deps.jobs.createShared(eventId)) ?? (await deps.jobs.findActiveShared(eventId));
  if (!job) throw new ConflictError("A playlist build just finished. Try again.");
  return building(job);
}

export async function getSharedStatus(
  deps: Pick<SharedBuildDeps, "jobs" | "shared" | "events">,
  eventId: EventId,
): Promise<SharedPlaylistStatus> {
  const event = await deps.events.getEvent(eventId);
  const [row, active] = await Promise.all([
    deps.shared.findByEvent(eventId),
    deps.jobs.findActiveShared(eventId),
  ]);
  if (active) {
    return { status: "building", jobId: active.id, ...(isBuilt(row) ? { url: row.url } : {}) };
  }
  if (!isBuilt(row)) return { status: "none" };
  return {
    status: "ready",
    url: row.url,
    builtAt: row.builtAt,
    stale: !isCurrent(row, event),
  };
}

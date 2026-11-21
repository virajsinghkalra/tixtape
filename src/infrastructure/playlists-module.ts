/**
 * Composition for the Playlist Engine (D-014). The Lead wires this into the container;
 * until then src/server/playlists.ts builds it.
 */
import type { SpotifyTokenRepository, UserRepository } from "@/application/auth/ports";
import {
  createPlaylistsUseCases,
  REQUEST_TIMEOUT_MS,
  type PlaylistsUseCases,
  type StartLimiter,
} from "@/application/playlists";
import type { Clock } from "@/application/ports/clock";
import type { MostListenedSource } from "@/application/ports/music-signals";
import type { EventLineupReader } from "@/application/ports/playlists";
import type { PlaylistWriter, TrackCatalog } from "@/application/ports/spotify";
import type { Database } from "@/db/client";
import type { Logger } from "@/lib/logger";
import { PgPlaylistJobRepository } from "./db/playlist-job-repository";
import { PgPublisherRepository } from "./db/publisher-repository";
import { PgSharedPlaylistRepository } from "./db/shared-playlist-repository";
import { AppleMusicTrending } from "./music-signals/apple-chart";
import {
  LastfmClient,
  LastfmMostListened,
  LastfmPopularity,
  type LastfmDeps,
} from "./music-signals/lastfm";
import { SpotifyNewReleases } from "./music-signals/spotify-new-releases";
import type { SpotifyHttpConfig } from "./spotify";

export { LASTFM_ATTRIBUTION } from "./music-signals/lastfm";

/**
 * D-020, D-045: Spotify retry settings that fit the 8 s step budget and the write lease margin
 * (`WRITE_LEASE_MARGIN_MS` = 2 attempts × REQUEST_TIMEOUT_MS + one 5 s wait). A 429 asking for
 * more than 5 s pauses the shared gate instead of sleeping; the runner retries on a later step.
 */
export const PLAYLIST_STEP_SPOTIFY_HTTP: Partial<SpotifyHttpConfig> = {
  maxWaitSeconds: 5,
  maxAttempts: 2,
};

/** Wraps `fetch` so every request is aborted after `ms` (D-045), keeping any caller signal. */
export function fetchWithTimeout(fetchFn: typeof fetch, ms = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchFn(input, { ...init, signal });
  };
}

export type PlaylistsModule = PlaylistsUseCases;

export type PlaylistsModuleDeps = {
  db: Database;
  clock: Clock;
  logger: Pick<Logger, "warn">;
  /** From a Spotify module configured with `PLAYLIST_STEP_SPOTIFY_HTTP`. */
  trackCatalog: TrackCatalog;
  playlistWriter: PlaylistWriter;
  events: EventLineupReader;
  users: Pick<UserRepository, "findById">;
  tokens: Pick<SpotifyTokenRepository, "find">;
  /** LASTFM_API_KEY. Without it the most-listened signal is empty and slots roll over. */
  lastfmApiKey?: string;
  /** Build-start limit (D-036). Defaults to the in-memory one; production passes Postgres (D-070). */
  limiter?: StartLimiter;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const noMostListened: MostListenedSource = { topTracks: async () => [] };

export function createPlaylistsModule(deps: PlaylistsModuleDeps): PlaylistsModule {
  const fetchFn = deps.fetch ?? ((...args) => fetch(...args));
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!deps.lastfmApiKey) {
    deps.logger.warn(
      {},
      "LASTFM_API_KEY is not set: playlists use Spotify signals only and tier-only weights",
    );
  }
  const lastfm: LastfmDeps | null = deps.lastfmApiKey
    ? { apiKey: deps.lastfmApiKey, fetch: fetchFn, sleep, clock: deps.clock }
    : null;
  // One client for both Last.fm calls, so they share the 5 requests/s pacing.
  const lastfmClient = lastfm ? new LastfmClient(lastfm) : null;
  return createPlaylistsUseCases({
    tracks: deps.trackCatalog,
    writer: deps.playlistWriter,
    mostListened:
      lastfm && lastfmClient ? new LastfmMostListened(lastfm, lastfmClient) : noMostListened,
    popularity: lastfm && lastfmClient ? new LastfmPopularity(lastfm, lastfmClient) : undefined,
    trending: new AppleMusicTrending({ fetch: fetchFn, clock: deps.clock }),
    newReleases: new SpotifyNewReleases(deps.trackCatalog, deps.clock),
    jobs: new PgPlaylistJobRepository(deps.db),
    shared: new PgSharedPlaylistRepository(deps.db),
    publisher: new PgPublisherRepository(deps.db),
    events: deps.events,
    users: deps.users,
    tokens: deps.tokens,
    clock: deps.clock,
    logger: deps.logger,
    limiter: deps.limiter,
  });
}

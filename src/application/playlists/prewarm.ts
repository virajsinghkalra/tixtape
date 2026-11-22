/**
 * D-080 pre-warm: resolve a published event's artists into the shared song cache ahead of
 * time, so "Make playlist" only has to write. Callers run this as the `prewarm` Spotify class
 * (≤ 1 call per 10 s, daily cap), so it never competes with a user's build.
 */
import type {
  ArtistSongs,
  ArtistSongsCache,
  EventLineupReader,
} from "@/application/ports/playlists";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import type { Clock } from "@/application/ports/clock";
import type { EventId } from "@/domain/shared/ids";
import {
  callsFor,
  enrichArtistSongs,
  entryFor,
  missingProviders,
  isUsable,
  resolveArtistSongs,
  type ArtistSongsDeps,
} from "./artist-songs";
import { budgetsFor, planBuild, type BuildPlan } from "./plan";

export type PrewarmDeps = ArtistSongsDeps & {
  events: EventLineupReader;
  songsCache: ArtistSongsCache;
  clock: Clock;
};

export type PrewarmResult = {
  artists: number;
  alreadyCached: number;
  resolved: number;
  /** Artists still uncached (out of time, or Spotify asked us to wait). */
  remaining: number;
  /** Set when Spotify's gate or our daily cap stopped the run. */
  stoppedUntil?: Date;
};

/** Expected seconds from "Make playlist" to done, for the panel (D-080). */
export type BuildReadiness = { cachedArtists: number; artists: number; seconds: number };

/** App-wide build pacing (8 calls / 10 s) plus create + ≤ 3 writes and step overhead. */
const SECONDS_PER_CALL = 1.25;
const WRITE_SECONDS = 5;

async function cachedState(
  deps: Pick<PrewarmDeps, "songsCache" | "clock"> & Partial<Pick<PrewarmDeps, "songScores">>,
  plan: BuildPlan,
) {
  const cache = await deps.songsCache.getMany(
    plan.artists.map((a) => a.artistId),
    plan.market,
  );
  const targets = budgetsFor(
    plan,
    plan.artists.map((a) => entryFor(cache, a)?.listeners ?? null),
  );
  const now = deps.clock.now();
  const missing = plan.artists.flatMap((a, i) => {
    const entry = entryFor(cache, a);
    const targetSongs = targets[i]?.songs ?? 1;
    if (!isUsable(entry, targetSongs, now)) return [{ artist: a, targetSongs, entry: undefined }];
    return deps.songScores && missingProviders({ songScores: deps.songScores }, entry!).length > 0
      ? [{ artist: a, targetSongs, entry }]
      : [];
  });
  return { missing, cached: plan.artists.length - missing.length };
}

export async function buildReadiness(
  deps: Pick<PrewarmDeps, "songsCache" | "clock">,
  plan: BuildPlan,
): Promise<BuildReadiness> {
  const { missing, cached } = await cachedState(deps, plan);
  // Enriching a cached entry costs no Spotify calls (D-085).
  const calls = missing.reduce((sum, m) => sum + (m.entry ? 0 : callsFor(m.targetSongs)), 0);
  return {
    cachedArtists: cached,
    artists: plan.artists.length,
    seconds: Math.round(WRITE_SECONDS + calls * SECONDS_PER_CALL),
  };
}

export async function prewarmEvent(
  deps: PrewarmDeps,
  eventId: EventId,
  opts: { deadline: Date },
): Promise<PrewarmResult> {
  const plan = planBuild(await deps.events.getEvent(eventId));
  const { missing, cached } = await cachedState(deps, plan);
  let resolved = 0;
  for (const { artist, targetSongs, entry } of missing) {
    if (deps.clock.now() >= opts.deadline) break;
    try {
      let songs: ArtistSongs;
      if (entry) {
        songs = await enrichArtistSongs(deps, entry, artist.name);
      } else {
        const outcome = await resolveArtistSongs(deps, {
          artist,
          market: plan.market,
          targetSongs,
          now: deps.clock.now(),
          keepGoing: () => deps.clock.now() < opts.deadline,
        });
        if (!outcome.done) {
          if (outcome.blocked) throw outcome.blocked;
          // Out of time mid-artist: nothing is cached (never a truncated pool); next run redoes it.
          break;
        }
        songs = outcome.songs;
      }
      await deps.songsCache.put(artist.artistId, plan.market, songs);
      resolved++;
    } catch (e) {
      if (!(e instanceof SpotifyBlockedError)) throw e;
      return {
        artists: plan.artists.length,
        alreadyCached: cached,
        resolved,
        remaining: missing.length - resolved,
        stoppedUntil: e.resumeAfter,
      };
    }
  }
  return {
    artists: plan.artists.length,
    alreadyCached: cached,
    resolved,
    remaining: missing.length - resolved,
  };
}

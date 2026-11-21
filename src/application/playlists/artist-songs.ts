/**
 * D-080: an artist's candidate songs with at most MAX_CALLS_PER_ARTIST Spotify calls, cached
 * for 14 days and shared by every event, rebuild and pre-warm.
 *
 * Ranking comes from Last.fm (free): `artist.getTopTracks` and listeners. Spotify only turns
 * titles into tracks: pages of `artist:"Name"` search (10 per call, the Dev Mode maximum),
 * sized to the artist's song budget (D-065; 1 page for ≤ 7 songs, 3 for a 23-song headliner,
 * 6 at most), then targeted `track:"T" artist:"A"` searches for top Last.fm titles the pages
 * missed, while the artist's calls stay within 3 (or its page count, if larger). Batch endpoints and artist top
 * tracks no longer exist for this app (Spotify February 2026 changes), so this is the floor.
 */
import type {
  ArtistPopularitySource,
  ChartEntry,
  MostListenedSource,
} from "@/application/ports/music-signals";
import type { ArtistSongs, CachedSong } from "@/application/ports/playlists";
import type { SpotifyTrack, TrackCatalog } from "@/application/ports/spotify";
import { fillToBudget } from "@/domain/playlists/budget";
import {
  rankArtistPool,
  type PickedTrack,
  type TrackCandidate,
} from "@/domain/playlists/selection";
import { normalizeTrackTitle, trackVersion } from "@/domain/playlists/track-title";
import type { ArtistId, SpotifyArtistId } from "@/domain/shared/ids";
import type { BillingTier } from "@/domain/shared/lineup";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { chartTitlesFor } from "./pick-artist-tracks";

export const SONGS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Calls per artist: festival artists need 1–3; only a long single-artist show needs more. */
export const MAX_CALLS_PER_ARTIST = 3;
/** A 150-minute single-artist concert (~40 songs) needs 6 pages; nothing pages further. */
export const MAX_SEARCH_PAGES = 6;
const SEARCH_PAGE = 10;
/** Fetch this many times the songs an artist needs, to survive filters and dedupe. */
const POOL_HEADROOM = 1.3;
/** Top Last.fm titles worth a targeted search when the pages missed them. */
const TARGETED_TITLES = 10;
const APP = { kind: "app" } as const;

export type ArtistSongsDeps = {
  tracks: TrackCatalog;
  mostListened: MostListenedSource;
  popularity: ArtistPopularitySource;
  logger: Pick<Logger, "warn">;
};

export type ArtistToResolve = { name: string; spotifyId: SpotifyArtistId };

/** Search pages an artist with this song budget needs (1–6). */
export const pagesFor = (targetSongs: number) =>
  Math.min(MAX_SEARCH_PAGES, Math.max(1, Math.ceil((targetSongs * POOL_HEADROOM) / SEARCH_PAGE)));

/** All calls for one artist: its pages, plus targeted searches up to 3 calls in total. */
export const callsFor = (targetSongs: number) =>
  Math.max(MAX_CALLS_PER_ARTIST, pagesFor(targetSongs));

/** The cached entry, if it was resolved for this Spotify artist (a re-match makes it stale). */
export const entryFor = (
  cache: ReadonlyMap<ArtistId, ArtistSongs>,
  artist: { artistId: ArtistId; spotifyId: SpotifyArtistId },
) => {
  const entry = cache.get(artist.artistId);
  return entry?.spotifyArtistId === artist.spotifyId ? entry : undefined;
};

/** Cached songs are usable while fresh and fetched deeply enough for this budget. */
export function isUsable(entry: ArtistSongs | undefined, targetSongs: number, now: Date) {
  if (!entry) return false;
  if (now.getTime() - entry.fetchedAt.getTime() >= SONGS_TTL_MS) return false;
  return entry.exhausted || entry.pages >= pagesFor(targetSongs);
}

const quoted = (s: string) => s.replace(/"/gu, "").trim();

async function lastfm<T>(
  deps: ArtistSongsDeps,
  what: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    deps.logger.warn({ err: e, what }, "Last.fm unavailable; using Spotify order only");
    return fallback;
  }
}

/**
 * Resolves one artist with at most `callsFor(targetSongs)` Spotify calls. Spotify errors
 * (`SpotifyBlockedError`, …) propagate so the caller can pause.
 */
export async function resolveArtistSongs(
  deps: ArtistSongsDeps,
  input: { artist: ArtistToResolve; market: string; targetSongs: number; now: Date },
): Promise<ArtistSongs> {
  const { artist, market } = input;
  const top = await lastfm(deps, "top tracks", () => deps.mostListened.topTracks(artist.name), []);
  const listeners = await lastfm(
    deps,
    "listeners",
    () => deps.popularity.listeners(artist.name),
    null,
  );
  const lastfmRank = new Map<string, number>();
  [...top]
    .sort((a, b) => b.playcount - a.playcount)
    .forEach((t, i) => {
      const key = normalizeTrackTitle(t.title);
      if (!lastfmRank.has(key)) lastfmRank.set(key, i + 1);
    });

  const found = new Map<string, SpotifyTrack>();
  const credited = (t: SpotifyTrack) => t.artistIds.includes(artist.spotifyId);
  let calls = 0;
  let pages = 0;
  let exhausted = false;
  for (; pages < pagesFor(input.targetSongs); pages++) {
    const page = await deps.tracks.searchTracks(`artist:"${quoted(artist.name)}"`, market, APP, {
      offset: pages * SEARCH_PAGE,
    });
    calls++;
    for (const t of page) if (credited(t) && !found.has(t.id)) found.set(t.id, t);
    if (page.length < SEARCH_PAGE) {
      exhausted = true;
      pages++;
      break;
    }
  }

  // Top Last.fm titles the pages missed, best first, while this artist's calls remain.
  const haveTitles = new Set([...found.values()].map((t) => normalizeTrackTitle(t.name)));
  const missing = [...lastfmRank.entries()]
    .filter(([title]) => !haveTitles.has(title))
    .sort((a, b) => a[1] - b[1])
    .slice(0, TARGETED_TITLES);
  for (const [title] of missing) {
    if (calls >= callsFor(input.targetSongs)) break;
    const original = top.find((t) => normalizeTrackTitle(t.title) === title)?.title ?? title;
    const hits = await deps.tracks.searchTracks(
      `track:"${quoted(original)}" artist:"${quoted(artist.name)}"`,
      market,
      APP,
    );
    calls++;
    const match =
      hits.find(
        (t) => credited(t) && normalizeTrackTitle(t.name) === title && !trackVersion(t.name),
      ) ?? hits.find((t) => credited(t) && normalizeTrackTitle(t.name) === title);
    if (match && !found.has(match.id)) found.set(match.id, match);
  }

  const songs: CachedSong[] = [...found.values()].map((t, i) => ({
    id: t.id,
    name: t.name,
    artistIds: t.artistIds,
    isrc: t.isrc,
    durationMs: t.durationMs,
    releaseDate: t.albumReleaseDate,
    searchRank: i,
    lastfmRank: lastfmRank.get(normalizeTrackTitle(t.name)) ?? null,
  }));
  return {
    spotifyArtistId: artist.spotifyId,
    songs,
    listeners,
    pages,
    exhausted,
    fetchedAt: input.now,
  };
}

const byTitles = (songs: readonly CachedSong[], titles: readonly string[]) => {
  const out: CachedSong[] = [];
  for (const title of titles.map(normalizeTrackTitle)) {
    for (const s of songs)
      if (normalizeTrackTitle(s.name) === title && !out.includes(s)) out.push(s);
  }
  return out;
};

/** D-038 signals rebuilt from cached songs; then D-065's fill to the artist's time budget. */
export function pickFromSongs(input: {
  artist: { spotifyId: SpotifyArtistId; name: string; tier: BillingTier };
  songs: readonly CachedSong[];
  chart: readonly ChartEntry[];
  budgetMs: number;
  minSongs: number;
  alreadyPicked: readonly PickedTrack[];
}): TrackCandidate[] {
  const { songs } = input;
  const mostListened = songs
    .filter((s) => s.lastfmRank !== null)
    .sort((a, b) => a.lastfmRank! - b.lastfmRank!);
  const trending = byTitles(songs, chartTitlesFor(input.artist.name, input.chart));
  const newest = [...songs]
    .filter((s) => s.releaseDate)
    .sort((a, b) => b.releaseDate!.localeCompare(a.releaseDate!))
    .slice(0, 3);
  const search = [...songs].sort((a, b) => a.searchRank - b.searchRank);
  const ranked = rankArtistPool({
    tier: input.artist.tier,
    artistId: input.artist.spotifyId,
    signals: { mostListened, trending, newest, search },
    alreadyPicked: input.alreadyPicked,
  });
  return fillToBudget(ranked, input.budgetMs, input.minSongs);
}

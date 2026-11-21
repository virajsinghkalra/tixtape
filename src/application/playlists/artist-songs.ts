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
  SongScoreProvider,
} from "@/application/ports/music-signals";
import { blendScore, lastfmScore, type SongProvider } from "@/domain/playlists/song-score";
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
  /** D-085: extra per-song signals (setlist.fm). Free sources: they cost no Spotify calls. */
  songScores: readonly SongScoreProvider[];
  logger: Pick<Logger, "warn">;
};

type ProviderResult = { id: SongScoreProvider["id"]; known: boolean; scores: Map<string, number> };

/** Every provider's scores by normalized title. A failing provider is skipped (retried later). */
async function providerScores(
  deps: ArtistSongsDeps,
  artistName: string,
  only?: ReadonlySet<string>,
): Promise<ProviderResult[]> {
  const out: ProviderResult[] = [];
  for (const provider of deps.songScores) {
    if (only && !only.has(provider.id)) continue;
    try {
      const r = await provider.scores(artistName);
      const scores = new Map<string, number>();
      for (const song of r.songs) {
        const key = normalizeTrackTitle(song.title);
        scores.set(key, Math.max(scores.get(key) ?? 0, song.score));
      }
      out.push({ id: provider.id, known: r.known, scores });
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      deps.logger.warn(
        { err: e, provider: provider.id, artist: artistName },
        "song signal unavailable",
      );
    }
  }
  return out;
}

/** Writes provider scores onto songs and records which providers were consulted. */
function withProviders(entry: ArtistSongs, results: readonly ProviderResult[]): ArtistSongs {
  const providers = { ...entry.providers };
  for (const r of results) providers[r.id] = { known: r.known };
  const songs = entry.songs.map((song) => {
    const providerScoresOf = { ...song.providerScores };
    for (const r of results) {
      const score = r.scores.get(normalizeTrackTitle(song.name));
      if (score !== undefined) providerScoresOf[r.id] = score;
      else delete providerScoresOf[r.id];
    }
    return { ...song, providerScores: providerScoresOf };
  });
  return { ...entry, providers, songs };
}

/** Providers this entry hasn't consulted yet (it was cached before they existed). */
export const missingProviders = (deps: Pick<ArtistSongsDeps, "songScores">, entry: ArtistSongs) =>
  deps.songScores.filter((p) => !entry.providers?.[p.id]).map((p) => p.id);

/** D-085: adds new providers' scores to a cached entry. No Spotify calls. */
export async function enrichArtistSongs(
  deps: ArtistSongsDeps,
  entry: ArtistSongs,
  artistName: string,
): Promise<ArtistSongs> {
  const results = await providerScores(deps, artistName, new Set(missingProviders(deps, entry)));
  return withProviders(entry, results);
}

/** Last.fm and every known provider, blended (D-085). */
function songScore(song: CachedSong, known: readonly SongProvider[]): number {
  return blendScore(
    { lastfm: lastfmScore(song.lastfmRank), setlistfm: song.providerScores?.setlistfm },
    known,
  );
}

/** Providers with data for this artist: Last.fm when it ranked any song, plus known providers. */
function knownProviders(entry: Pick<ArtistSongs, "songs" | "providers">): SongProvider[] {
  const known: SongProvider[] = [];
  if (entry.songs.some((s) => s.lastfmRank !== null)) known.push("lastfm");
  if (entry.providers?.setlistfm?.known) known.push("setlistfm");
  return known;
}

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
  const providers = await providerScores(deps, artist.name);

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

  // The best-scored titles (Last.fm + live setlists, D-085) the pages missed, while this
  // artist's calls remain.
  const haveTitles = new Set([...found.values()].map((t) => normalizeTrackTitle(t.name)));
  const known: SongProvider[] = [
    ...(lastfmRank.size > 0 ? (["lastfm"] as const) : []),
    ...providers.filter((p) => p.known).map((p) => p.id),
  ];
  const candidates = new Set([
    ...lastfmRank.keys(),
    ...providers.flatMap((p) => [...p.scores.keys()]),
  ]);
  const missing = [...candidates]
    .filter((title) => !haveTitles.has(title))
    .map((title) => ({
      title,
      score: blendScore(
        {
          lastfm: lastfmScore(lastfmRank.get(title) ?? null),
          setlistfm: providers.find((p) => p.id === "setlistfm")?.scores.get(title),
        },
        known,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TARGETED_TITLES);
  const spelled = new Map<string, string>(top.map((t) => [normalizeTrackTitle(t.title), t.title]));
  for (const { title } of missing) {
    if (calls >= callsFor(input.targetSongs)) break;
    const original = spelled.get(title) ?? title;
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
  return withProviders(
    { spotifyArtistId: artist.spotifyId, songs, listeners, pages, exhausted, fetchedAt: input.now },
    providers,
  );
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
  /** D-085: which providers had data for this artist (from the cache entry). */
  providers?: ArtistSongs["providers"];
  chart: readonly ChartEntry[];
  budgetMs: number;
  minSongs: number;
  alreadyPicked: readonly PickedTrack[];
}): TrackCandidate[] {
  const { songs } = input;
  // D-085: "most listened" is now Last.fm blended with live setlists; ties keep search order.
  const known = knownProviders({ songs: [...songs], providers: input.providers });
  const scored = songs.map((song) => ({ song, score: songScore(song, known) }));
  const mostListened = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.song.searchRank - b.song.searchRank)
    .map((x) => x.song);
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

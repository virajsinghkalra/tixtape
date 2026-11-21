/**
 * Gathers one artist's signals, maps them to Spotify tracks and picks the songs (D-038).
 * Spotify errors propagate (the runner pauses on them). A Last.fm or Apple failure only means
 * that signal is empty for this artist.
 */
import type {
  ChartEntry,
  MostListenedSource,
  NewReleaseSource,
} from "@/application/ports/music-signals";
import type { ArtistPool, PoolTrack } from "@/application/ports/playlists";
import type { SpotifyTrack, TrackCatalog } from "@/application/ports/spotify";
import { fillToBudget } from "@/domain/playlists/budget";
import {
  rankArtistPool,
  selectArtistTracks,
  TIER_QUOTAS,
  type PickedTrack,
  type TrackCandidate,
} from "@/domain/playlists/selection";
import { normalizeTrackTitle, trackVersion } from "@/domain/playlists/track-title";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import type { BillingTier } from "@/domain/shared/lineup";
import { normalizeArtistName, splitArtistCredit } from "@/domain/shared/normalize";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";

/** Extra titles mapped beyond a signal's quota, to survive filters and dedupe. */
const MAPPING_HEADROOM = 2;
const APP = { kind: "app" } as const;

export type SignalDeps = {
  tracks: TrackCatalog;
  mostListened: MostListenedSource;
  newReleases: NewReleaseSource;
  logger: Pick<Logger, "warn">;
};

export type LineupArtistToPick = {
  name: string;
  spotifyId: SpotifyArtistId;
  tier: BillingTier;
};

const quoted = (s: string) => s.replace(/"/gu, "").trim();

/** Chart credits join artists with commas as well as "&", "and", feat. and x (D-045). */
const CHART_JOINER = /\s*,\s*|\s+(?:&|and)\s+/iu;

/**
 * Every name a chart credit could mean: the whole credit (a band like "Simon & Garfunkel"),
 * and each artist after splitting with the shared credit splitter plus the chart joiners.
 * "Pritam, Arijit Singh & Amitabh Bhattacharya" → includes "Arijit Singh".
 */
function chartCreditNames(credit: string): Set<string> {
  const names = new Set([normalizeArtistName(credit)]);
  for (const part of credit.split(/\s*,\s*/u)) {
    for (const artist of splitArtistCredit(part)) {
      names.add(normalizeArtistName(artist));
      for (const piece of artist.split(CHART_JOINER)) names.add(normalizeArtistName(piece));
    }
  }
  names.delete("");
  return names;
}

/** Chart entries credited to this artist, best rank first (D-043, D-045). */
export function chartTitlesFor(artistName: string, chart: readonly ChartEntry[]): string[] {
  const target = normalizeArtistName(artistName);
  return chart
    .filter((e) => chartCreditNames(e.artistName).has(target))
    .sort((a, b) => a.rank - b.rank)
    .map((e) => e.title);
}

async function topTitles(deps: SignalDeps, name: string, limit: number): Promise<string[]> {
  try {
    const top = await deps.mostListened.topTracks(name);
    return [...top]
      .sort((a, b) => b.playcount - a.playcount)
      .slice(0, limit)
      .map((t) => t.title);
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    deps.logger.warn({ err: e, artist: name }, "most-listened signal unavailable");
    return [];
  }
}

/**
 * `track:"T" artist:"A"`, keeping only a result credited to the artist whose normalized title
 * matches (D-038). The artist's own search results are checked first to save a call.
 */
async function mapTitle(
  deps: SignalDeps,
  artist: LineupArtistToPick,
  title: string,
  market: string,
  known: readonly SpotifyTrack[],
): Promise<SpotifyTrack | null> {
  const key = normalizeTrackTitle(title);
  const matches = (t: SpotifyTrack) =>
    t.artistIds.includes(artist.spotifyId) && normalizeTrackTitle(t.name) === key;
  const hit = preferOriginal(known, matches);
  if (hit) return hit;
  const query = `track:"${quoted(title)}" artist:"${quoted(artist.name)}"`;
  const found = await deps.tracks.searchTracks(query, market, APP);
  return preferOriginal(found, matches);
}

/** The first match that isn't a live/remix/… version, else the first match. */
function preferOriginal(
  tracks: readonly SpotifyTrack[],
  matches: (t: SpotifyTrack) => boolean,
): SpotifyTrack | null {
  return (
    tracks.find((t) => matches(t) && trackVersion(t.name) === null) ?? tracks.find(matches) ?? null
  );
}

async function mapTitles(
  deps: SignalDeps,
  artist: LineupArtistToPick,
  titles: readonly string[],
  market: string,
  known: readonly SpotifyTrack[],
): Promise<SpotifyTrack[]> {
  const out: SpotifyTrack[] = [];
  for (const title of titles) {
    const track = await mapTitle(deps, artist, title, market, known);
    if (track) out.push(track);
  }
  return out;
}

export async function pickArtistTracks(
  deps: SignalDeps,
  input: {
    artist: LineupArtistToPick;
    market: string;
    chart: readonly ChartEntry[];
    alreadyPicked: readonly PickedTrack[];
  },
): Promise<TrackCandidate[]> {
  const { artist, market } = input;
  const quota = TIER_QUOTAS[artist.tier];
  const search = await deps.tracks.searchTracks(`artist:"${quoted(artist.name)}"`, market, APP);
  const mostListenedTitles = await topTitles(
    deps,
    artist.name,
    quota.mostListened + MAPPING_HEADROOM,
  );
  const trendingTitles = chartTitlesFor(artist.name, input.chart).slice(
    0,
    quota.trending + MAPPING_HEADROOM,
  );
  const mostListened = await mapTitles(deps, artist, mostListenedTitles, market, search);
  const trending = await mapTitles(deps, artist, trendingTitles, market, search);
  const newest = await deps.newReleases.newestTracks(
    artist.spotifyId,
    market,
    Math.max(quota.newest, 1) + MAPPING_HEADROOM,
  );
  return selectArtistTracks({
    tier: artist.tier,
    artistId: artist.spotifyId,
    signals: { mostListened, trending, newest, search },
    alreadyPicked: input.alreadyPicked,
  });
}

// ── D-065: an artist's pool, gathered in small checkpointed units ──────────

/** Titles mapped to Spotify per unit of work (each may cost one search). */
const MAP_CHUNK = 3;
/** Releases opened per artist when the signals don't give enough songs (Spotify lists 10). */
const MAX_ALBUMS = 10;
/** Gather this many times the songs an artist needs, to survive filters and dedupe. */
const POOL_HEADROOM = 1.5;
/** Last.fm returns at most this many top tracks per request (see the adapter). */
const MAX_TOP_TITLES = 50;

export type PoolContext = {
  artist: LineupArtistToPick;
  market: string;
  /** Songs this artist's time budget needs (D-065). */
  targetSongs: number;
  chart: () => Promise<readonly ChartEntry[]>;
  /** False once the step's time is up: multi-call units stop early (after at least one call). */
  keepGoing?: () => boolean;
};

const toPoolTrack = (t: SpotifyTrack): PoolTrack => ({
  id: t.id,
  name: t.name,
  artistIds: t.artistIds,
  isrc: t.isrc,
  durationMs: t.durationMs,
});

const poolSize = (p: ArtistPool) =>
  new Set(
    [...p.search, ...p.mostListened, ...p.trending, ...p.newest, ...p.albums].map((t) => t.id),
  ).size;

const enough = (p: ArtistPool, ctx: PoolContext) =>
  poolSize(p) >= Math.ceil(ctx.targetSongs * POOL_HEADROOM);

/**
 * Does one unit of work on the current artist's pool and returns the new pool. Phases:
 * signals (artist search, Last.fm, chart) → newest releases → map titles, a few per unit →
 * album tracks by recency, one release per unit, only while the pool is short → ready.
 * Spotify errors propagate; Last.fm/Apple failures only empty their signal.
 */
export async function advancePool(
  deps: SignalDeps,
  ctx: PoolContext,
  pool: ArtistPool | null,
): Promise<ArtistPool> {
  const { artist, market } = ctx;
  if (!pool) {
    const quota = TIER_QUOTAS[artist.tier];
    const search = await deps.tracks.searchTracks(`artist:"${quoted(artist.name)}"`, market, APP);
    const topLimit = Math.min(
      MAX_TOP_TITLES,
      Math.max(quota.mostListened, ctx.targetSongs) + MAPPING_HEADROOM,
    );
    const top = await topTitles(deps, artist.name, topLimit);
    const trending = chartTitlesFor(artist.name, await ctx.chart()).slice(
      0,
      quota.trending + MAPPING_HEADROOM,
    );
    return {
      phase: "newest",
      search: search.map(toPoolTrack),
      mostListened: [],
      trending: [],
      newest: [],
      albums: [],
      toMap: [
        ...top.map((title) => ({ title, signal: "mostListened" as const })),
        ...trending.map((title) => ({ title, signal: "trending" as const })),
      ],
      albumIds: null,
    };
  }
  switch (pool.phase) {
    case "signals":
    case "newest": {
      const limit = Math.max(TIER_QUOTAS[artist.tier].newest, 1) + MAPPING_HEADROOM;
      const newest = await deps.newReleases.newestTracks(artist.spotifyId, market, limit);
      return { ...pool, phase: "map", newest: newest.map(toPoolTrack) };
    }
    case "map":
      return mapChunk(deps, ctx, pool);
    case "albums":
      return openNextAlbum(deps, ctx, pool);
    case "ready":
      return pool;
  }
}

async function mapChunk(deps: SignalDeps, ctx: PoolContext, pool: ArtistPool): Promise<ArtistPool> {
  const next = { ...pool, mostListened: [...pool.mostListened], trending: [...pool.trending] };
  const known: SpotifyTrack[] = pool.search.map((t) => ({
    ...t,
    albumId: "",
    albumReleaseDate: null,
    rank: 0,
  }));
  let mapped = 0;
  for (const item of pool.toMap.slice(0, MAP_CHUNK)) {
    if (mapped > 0 && ctx.keepGoing && !ctx.keepGoing()) break;
    const track = await mapTitle(deps, ctx.artist, item.title, ctx.market, known);
    if (track) next[item.signal].push(toPoolTrack(track));
    mapped++;
  }
  next.toMap = pool.toMap.slice(mapped);
  if (next.toMap.length > 0) return next;
  return { ...next, phase: enough(next, ctx) ? "ready" : "albums" };
}

async function openNextAlbum(
  deps: SignalDeps,
  ctx: PoolContext,
  pool: ArtistPool,
): Promise<ArtistPool> {
  if (pool.albumIds === null) {
    const albums = await deps.tracks.getArtistAlbums(ctx.artist.spotifyId, ctx.market, APP);
    const ids = albums
      .filter((a) => a.albumType === "album" || a.albumType === "single")
      .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
      .slice(0, MAX_ALBUMS)
      .map((a) => a.id);
    return { ...pool, albumIds: ids, phase: ids.length > 0 ? "albums" : "ready" };
  }
  const [albumId, ...rest] = pool.albumIds;
  if (albumId === undefined) return { ...pool, phase: "ready" };
  const tracks = await deps.tracks.getAlbumTracks(albumId, ctx.market, APP);
  const next: ArtistPool = {
    ...pool,
    albums: [
      ...pool.albums,
      ...tracks.filter((t) => t.artistIds.includes(ctx.artist.spotifyId)).map(toPoolTrack),
    ],
    albumIds: rest,
  };
  return { ...next, phase: rest.length === 0 || enough(next, ctx) ? "ready" : "albums" };
}

/** D-065: the ranked pool, filled to the artist's time budget. */
export function pickFromPool(input: {
  artist: LineupArtistToPick;
  pool: ArtistPool;
  budgetMs: number;
  minSongs: number;
  alreadyPicked: readonly PickedTrack[];
}): TrackCandidate[] {
  const { pool } = input;
  const ranked = rankArtistPool({
    tier: input.artist.tier,
    artistId: input.artist.spotifyId,
    signals: {
      mostListened: pool.mostListened,
      trending: pool.trending,
      newest: pool.newest,
      search: pool.search,
      albums: pool.albums,
    },
    alreadyPicked: input.alreadyPicked,
  });
  return fillToBudget(ranked, input.budgetMs, input.minSongs);
}

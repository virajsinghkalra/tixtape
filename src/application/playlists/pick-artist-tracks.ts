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
import type { SpotifyTrack, TrackCatalog } from "@/application/ports/spotify";
import {
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

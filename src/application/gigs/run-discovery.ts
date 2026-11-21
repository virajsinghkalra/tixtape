/**
 * One artist-first discovery run (D-073): build the watchlist, pick this run's artists within
 * the daily caps, discover their India shows, keep only Spotify-confirmed artists, and store
 * each night as a candidate (`event_candidates`, with provenance). Never publishes.
 */
import type { CandidateSource, CandidateStore } from "@/application/ingestion/ports";
import { validateCandidates } from "@/application/ingestion/collect-events";
import type { ArtistValidator } from "@/application/ingestion/validate-artists";
import type { Clock } from "@/application/ports/clock";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { dedupeKey } from "@/domain/events/dedupe";
import type { ValidatedGig } from "@/domain/gigs/nights";
import {
  buildWatchlist,
  pickForRun,
  searchedTermMeaning,
  type WatchArtist,
  type WatchSignal,
} from "@/domain/gigs/watchlist";
import type { Logger } from "@/lib/logger";
import type { ArtistGigDiscovery, DiscoveryNote } from "./discover-artist-gigs";
import {
  DEMAND_WINDOW_DAYS,
  metroDemand,
  pickByDemand,
  planRun,
  type PlannedArtist,
  type RunPlan,
} from "@/domain/gigs/demand";
import { isoDate } from "@/domain/gigs/extract";
import type {
  ArtistCities,
  CatalogueArtists,
  CityDemandStore,
  CityShowCounts,
  SearchedTerms,
  TrendingArtists,
} from "./ports";

const DAY_MS = 86_400_000;
const SEARCH_WINDOW_MS = 14 * DAY_MS;
export const WATCHLIST_SIZE = 300;

export type WatchlistDeps = {
  trending: TrendingArtists | null;
  catalogue: CatalogueArtists;
  searched: SearchedTerms;
  validator: ArtistValidator;
  clock: Clock;
  logger: Pick<Logger, "warn">;
};

/** The merged watchlist. Searched terms count only when Spotify confirms them as an artist. */
export async function loadWatchlist(deps: WatchlistDeps): Promise<WatchArtist[]> {
  const now = deps.clock.now();
  const signals: WatchSignal[] = [];
  const guard = async <T>(what: string, f: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof SpotifyBlockedError) throw e;
      deps.logger.warn({ err: e, what }, "gigs: watchlist signal failed");
      return [];
    }
  };
  const catalogue = await guard("catalogue", () => deps.catalogue.matched(WATCHLIST_SIZE));
  for (const a of catalogue) {
    signals.push({ name: a.name, origin: "catalogue", weight: 0, spotifyId: a.spotifyId });
  }
  for (const t of await guard("searched", () =>
    deps.searched.recent(new Date(now.getTime() - SEARCH_WINDOW_MS), 50),
  )) {
    const meaning = searchedTermMeaning(t.term, catalogue);
    if (meaning.kind === "place") continue;
    // Our own artist first; otherwise only an exact Spotify artist counts.
    const name = meaning.kind === "catalogue" ? meaning.name : await deps.validator.confirm(t.term);
    if (!name) continue;
    const known = catalogue.find((a) => a.name === name);
    signals.push({
      name,
      origin: "searched",
      weight: t.count,
      spotifyId: known?.spotifyId ?? deps.validator.spotifyIdOf(name),
    });
  }
  if (deps.trending) {
    for (const a of await guard("trending", () => deps.trending!.topInIndia(100))) {
      signals.push({ name: a.name, origin: "trending", weight: a.listeners });
    }
  }
  return buildWatchlist(signals, WATCHLIST_SIZE);
}

export type DiscoveryRunDeps = {
  discovery: ArtistGigDiscovery;
  validator: ArtistValidator;
  store: CandidateStore;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn">;
};

export type DiscoveryRunReport = {
  artists: DiscoveryNote[];
  candidates: ValidatedGig[];
  /** Set when Spotify asked us to stop; the run ends early. */
  blockedUntil: Date | null;
};

/** Discovers shows for the given artists; writes candidates unless `write` is false. */
export async function runDiscovery(
  deps: DiscoveryRunDeps,
  artists: ReadonlyArray<WatchArtist | PlannedArtist>,
  opts: { write: boolean },
): Promise<DiscoveryRunReport> {
  const now = deps.clock.now();
  const report: DiscoveryRunReport = { artists: [], candidates: [], blockedUntil: null };
  for (const artist of artists) {
    // Official sites need a Spotify ID; confirm searched or trending names first.
    const spotifyId =
      artist.spotifyId ??
      ((await confirmOrNull(deps.validator, artist.name, report))
        ? deps.validator.spotifyIdOf(artist.name)
        : null);
    if (report.blockedUntil) break;
    const { candidates, note } = await deps.discovery.discover(
      { ...artist, spotifyId },
      focusOf(artist),
    );
    report.artists.push(note);
    try {
      const { validated } = await validateCandidates(deps.validator, candidates);
      // `validateCandidates` keeps every other field, provenance included.
      const gigs = validated as ValidatedGig[];
      if (opts.write) for (const c of gigs) await deps.store.upsert(c, dedupeKey(c), now);
      report.candidates.push(...gigs);
    } catch (e) {
      if (!(e instanceof SpotifyBlockedError)) throw e;
      report.blockedUntil = e.resumeAfter;
      break;
    }
  }
  return report;
}

async function confirmOrNull(
  validator: ArtistValidator,
  name: string,
  report: DiscoveryRunReport,
): Promise<string | null> {
  try {
    return await validator.confirm(name);
  } catch (e) {
    if (!(e instanceof SpotifyBlockedError)) throw e;
    report.blockedUntil = e.resumeAfter;
    return null;
  }
}

/** This run's artists: `only` (by name) when given, else the rotation within `perRun`. */
export function artistsForRun(
  list: readonly WatchArtist[],
  opts: {
    perRun: number;
    now: Date;
    only?: readonly string[];
    /** D-081: weight the run by visitor demand. */
    plan?: RunPlan;
    artistCities?: ReadonlyArray<{ name: string; city: string }>;
  },
): Array<WatchArtist | PlannedArtist> {
  if (opts.only && opts.only.length > 0) {
    const wanted = opts.only.map((n) => n.trim().toLowerCase());
    const found = list.filter(
      (a) => wanted.includes(a.name.toLowerCase()) || wanted.includes(a.key),
    );
    const missing = opts.only.filter(
      (n) =>
        !found.some(
          (a) =>
            a.name.toLowerCase() === n.trim().toLowerCase() || a.key === n.trim().toLowerCase(),
        ),
    );
    // Names not on the watchlist are still looked up (e.g. a Lead's one-off run).
    return [
      ...found,
      ...missing.map((name) => ({
        name: name.trim(),
        key: name.trim().toLowerCase(),
        spotifyId: null,
        origins: [],
        score: 0,
      })),
    ];
  }
  const runIndex = Math.floor(opts.now.getTime() / DAY_MS);
  if (opts.plan) {
    return pickByDemand(list, opts.artistCities ?? [], opts.plan, opts.perRun, runIndex);
  }
  return pickForRun(list, opts.perRun, runIndex);
}

/**
 * D-073 live lookup hook: discovery for one recognised artist, inside the lookup's time cap.
 * Nights are stored as candidates (never published); returns how many.
 */
export function artistGigLookup(deps: DiscoveryRunDeps): {
  lookUp(artist: { name: string; spotifyId: string }): Promise<number>;
} {
  return {
    async lookUp(artist) {
      const report = await runDiscovery(
        deps,
        [
          {
            name: artist.name,
            key: artist.name.toLowerCase(),
            spotifyId: artist.spotifyId,
            origins: ["searched"],
            score: 0,
          },
        ],
        { write: true },
      );
      return report.candidates.length;
    },
  };
}

export type ListingRunReport = {
  sources: Array<{ source: string; items: number; error: string | null }>;
  candidates: ValidatedGig[];
  blockedUntil: Date | null;
};

/**
 * Gig listings (HighApe, D-073): every item is one night with its own provenance. Artists are
 * validated on Spotify and nights stored as candidates for the gate; nothing is clustered here.
 */
export async function runListings(
  deps: Omit<DiscoveryRunDeps, "discovery">,
  sources: readonly CandidateSource[],
  opts: { write: boolean },
): Promise<ListingRunReport> {
  const now = deps.clock.now();
  const report: ListingRunReport = { sources: [], candidates: [], blockedUntil: null };
  for (const source of sources) {
    const entry = { source: source.source, items: 0, error: null as string | null };
    report.sources.push(entry);
    const found = [];
    try {
      for await (const c of source.collect({ now })) {
        entry.items++;
        found.push(c);
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      deps.logger.warn({ err: e, source: source.source }, "gigs: listing failed");
    }
    try {
      const { validated } = await validateCandidates(deps.validator, found);
      const gigs = (validated as ValidatedGig[]).filter((c) => c.artists.length > 0);
      if (opts.write) for (const c of gigs) await deps.store.upsert(c, dedupeKey(c), now);
      report.candidates.push(...gigs);
    } catch (e) {
      if (!(e instanceof SpotifyBlockedError)) throw e;
      report.blockedUntil = e.resumeAfter;
      break;
    }
  }
  return report;
}

/** D-081: floor artists get a smaller page budget; demand artists the full one. */
export const FLOOR_PAGES_PER_ARTIST = 2;

function focusOf(artist: WatchArtist | PlannedArtist): { cities?: string[]; pages?: number } {
  if (!("reason" in artist)) return {};
  return {
    cities: artist.focusCities,
    ...(artist.reason === "floor" ? { pages: FLOOR_PAGES_PER_ARTIST } : {}),
  };
}

export type DemandDeps = {
  demand: CityDemandStore;
  shows: CityShowCounts;
  artistCities: ArtistCities;
  clock: Clock;
  logger: Pick<Logger, "warn">;
};

const ARTIST_CITY_WINDOW_MS = 365 * DAY_MS;

/**
 * D-081: the run plan from visitor demand (last 14 days) and upcoming published shows, plus
 * the cities our artists play in. Any failure gives an empty plan: the plain rotation.
 */
export async function loadRunPlan(
  deps: DemandDeps,
  perRun: number,
): Promise<{ plan: RunPlan; artistCities: Array<{ name: string; city: string }> }> {
  const now = deps.clock.now();
  try {
    const [counts, shows, artistCities] = await Promise.all([
      deps.demand.since(isoDate(new Date(now.getTime() - DEMAND_WINDOW_DAYS * DAY_MS))),
      deps.shows.upcomingPublished(now),
      deps.artistCities.list(new Date(now.getTime() - ARTIST_CITY_WINDOW_MS)),
    ]);
    return { plan: planRun(metroDemand(counts, now), shows, perRun), artistCities };
  } catch (e) {
    deps.logger.warn({ err: e }, "gigs: demand plan unavailable; using the plain rotation");
    return { plan: { metros: [], floorSlots: perRun }, artistCities: [] };
  }
}

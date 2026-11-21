/**
 * The artist watchlist for artist-first discovery (D-073). Pure: callers gather the signals.
 * - `searched`: artists people looked for (search_log) come first: they're demand we know of;
 * - `catalogue`: artists already in our lineups (matched on Spotify);
 * - `trending`: Last.fm `geo.getTopArtists` for India, by rank.
 * Names are merged on the shared artist normalizer, so one artist is one entry. Each run takes
 * every searched artist, then a rotating slice of the rest, so the whole list is covered every
 * few days within the daily caps.
 */
import { findCity } from "../events/extract/places";
import { foldText } from "../events/text";
import { normalizeArtistName } from "../shared/normalize";

export const WATCH_ORIGINS = ["searched", "catalogue", "trending"] as const;
export type WatchOrigin = (typeof WATCH_ORIGINS)[number];

export type WatchSignal = {
  name: string;
  origin: WatchOrigin;
  /** Higher first within an origin (e.g. listeners, search count). */
  weight: number;
  spotifyId?: string | null;
};

export type WatchArtist = {
  name: string;
  key: string;
  spotifyId: string | null;
  origins: WatchOrigin[];
  score: number;
};

const ORIGIN_SCORE: Readonly<Record<WatchOrigin, number>> = {
  searched: 3,
  catalogue: 2,
  trending: 1,
};

/** One entry per normalized name, best first; names too short to search are dropped. */
export function buildWatchlist(signals: readonly WatchSignal[], limit: number): WatchArtist[] {
  const byKey = new Map<string, WatchArtist & { weight: number }>();
  for (const s of signals) {
    const key = normalizeArtistName(s.name);
    if (key.length < 3) continue;
    const entry = byKey.get(key) ?? {
      name: s.name.trim(),
      key,
      spotifyId: null,
      origins: [],
      score: 0,
      weight: 0,
    };
    if (!entry.origins.includes(s.origin)) {
      entry.origins.push(s.origin);
      entry.score += ORIGIN_SCORE[s.origin];
    }
    entry.weight = Math.max(entry.weight, s.weight);
    entry.spotifyId ??= s.spotifyId ?? null;
    // Prefer the catalogue's spelling (Spotify's), then any.
    if (s.origin === "catalogue") entry.name = s.name.trim();
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ weight: _weight, ...artist }) => artist);
}

/**
 * This run's artists: every searched one (up to `perRun`), then a rotating slice of the rest
 * chosen by `runIndex` (e.g. days since epoch), so consecutive runs cover different artists.
 */
export function pickForRun(
  list: readonly WatchArtist[],
  perRun: number,
  runIndex: number,
): WatchArtist[] {
  if (perRun <= 0) return [];
  const searched = list.filter((a) => a.origins.includes("searched")).slice(0, perRun);
  const rest = list.filter((a) => !a.origins.includes("searched"));
  const slots = perRun - searched.length;
  if (slots <= 0 || rest.length === 0) return searched;
  const start = (Math.max(0, Math.floor(runIndex)) * slots) % rest.length;
  const picked: WatchArtist[] = [];
  for (let i = 0; i < Math.min(slots, rest.length); i++) {
    picked.push(rest[(start + i) % rest.length]!);
  }
  return [...searched, ...picked];
}

export type SearchedTermMeaning =
  { kind: "catalogue"; name: string } | { kind: "place" } | { kind: "unknown" };

/**
 * What a typed search term most likely means before asking Spotify: a city ("pune") is never
 * an artist; a word of an artist we already list ("garrix", "diljit") means that artist, not
 * a same-named stranger on Spotify. Anything else still needs Spotify to confirm it.
 */
export function searchedTermMeaning(
  term: string,
  catalogue: ReadonlyArray<{ name: string }>,
): SearchedTermMeaning {
  const folded = foldText(term);
  if (folded === "" || findCity(folded) !== null) return { kind: "place" };
  const key = normalizeArtistName(term);
  const exact = catalogue.find((a) => normalizeArtistName(a.name) === key);
  if (exact) return { kind: "catalogue", name: exact.name };
  const partial = catalogue.filter((a) => ` ${normalizeArtistName(a.name)} `.includes(` ${key} `));
  return partial.length === 1 ? { kind: "catalogue", name: partial[0]!.name } : { kind: "unknown" };
}

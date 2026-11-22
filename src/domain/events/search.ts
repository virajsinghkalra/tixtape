/**
 * Event search (D-042, D-047): query building, the SQL-facing plan, match classification,
 * ranking, entity suggestions and "did you mean". Pure. The repository fetches candidates
 * with similarity scores using `SearchPlan`; this module decides what matched and why.
 */
import type { EventType } from "@/domain/shared/lineup";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { NAME_MATCH_THRESHOLD, phoneticKey, phoneticNameSimilarity } from "./phonetic";
import {
  compactAlnum,
  GENRES,
  parseSearchText,
  splitAlnum,
  type SearchFilters,
} from "./query-parse";
import { jaroWinkler } from "./similarity";
import { foldText } from "./text";
import { decayedTrend } from "./trend";
import { canonicalCity, normalizeCity, normalizeVenueName } from "./venue";

export type { SearchFilters } from "./query-parse";

export const SUGGEST_LIMIT = 8;
export const SUGGEST_MIN_LENGTH = 2;
export const SUGGEST_MAX_LENGTH = 100;
export const ENTITY_LIMIT = 3;
/** Below this many characters, matching is prefix-only and never fuzzy (D-047 issue 1). */
export const SHORT_QUERY_LENGTH = 4;
/** pg_trgm `word_similarity` at or above this counts as a typo-tolerant match. */
export const FUZZY_THRESHOLD = 0.5;
/** Between this and `FUZZY_THRESHOLD`: not a match, but a "did you mean" hint. */
export const NEAR_MISS_THRESHOLD = 0.3;
/** An event with no end time is treated as running this long after it starts. */
export const DEFAULT_EVENT_DURATION_MS = 12 * 3_600_000;

/**
 * Well-known nicknames → words in the event's real title. Keys and values are folded and
 * compacted ("nh 7" is typed as "nh7"). Add entries here; nothing else needs to change.
 */
export const EVENT_NICKNAMES: Readonly<Record<string, string>> = {
  lolla: "lollapalooza",
  nh7: "nh7 weekender",
  weekender: "nh7 weekender",
  vh1: "supersonic",
  "vh1 supersonic": "supersonic",
  zoma: "zomaland",
  magnetic: "magnetic fields",
  hornbill: "hornbill",
  sunburn: "sunburn",
  ziro: "ziro festival",
  "comic con": "comic con",
};

// ── Query ─────────────────────────────────────────────────────────────────

export type SearchQuery = {
  /** Free text after filters are removed: folded and compacted ("NH 7" → "nh7"). */
  text: string;
  tokens: string[];
  /** Under `SHORT_QUERY_LENGTH` characters: prefix-only matching. */
  short: boolean;
  phonetic: string;
  /** `normalizeArtistName(text)`, compared with `artists.normalized_name`. */
  artistKey: string;
  artistPhonetic: string;
  /** `normalizeVenueName(text)`, compared with `venues.normalized_name`. */
  venueKey: string;
  aliasTargets: string[];
  filters: SearchFilters;
  /** Words that became date/type/genre filters, shown for filter-only results. */
  filterLabel: string | null;
};

/**
 * Collapses whitespace and drops control characters (a NUL byte made Postgres fail, QA-F-14);
 * the length rule (2–100) applies to this form.
 */
export const tidyQuery = (raw: string) => cleanQueryText(raw).trim().replace(/\s+/gu, " ");

/** Control characters (NUL, escapes, …) become spaces: they never mean anything in a search. */
export function cleanQueryText(raw: string): string {
  return raw.replace(/\p{Cc}/gu, " ");
}

/** `explicit` filters (from URL parameters) override ones parsed from the text. */
export function buildSearchQuery(
  raw: string,
  now: Date,
  explicit: SearchFilters = {},
): SearchQuery {
  const parsed = parseSearchText(raw, now);
  const text = parsed.text;
  const artistKey = normalizeArtistName(text);
  const aliasTargets = new Set<string>();
  for (const [nickname, target] of Object.entries(EVENT_NICKNAMES)) {
    if (text === nickname || ` ${text} `.includes(` ${nickname} `)) aliasTargets.add(target);
  }
  const defined = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
  return {
    text,
    tokens: parsed.tokens,
    short: [...text].length < SHORT_QUERY_LENGTH,
    phonetic: phoneticKey(text),
    artistKey,
    artistPhonetic: phoneticKey(artistKey),
    venueKey: text === "" ? "" : normalizeVenueName(text),
    aliasTargets: [...aliasTargets],
    filters: { ...parsed.filters, ...defined },
    filterLabel: parsed.filterLabel,
  };
}

// ── Plan for the repository ───────────────────────────────────────────────

/** Everything the SQL needs, decided here so short-query and spelling rules live in one place. */
export type SearchPlan = {
  hasText: boolean;
  /** Trigram and phonetic matching allowed (not for short queries). */
  fuzzy: boolean;
  text: string;
  phonetic: string;
  artistKey: string;
  artistPhonetic: string;
  venueKey: string;
  /** LIKE patterns on the folded title; any may match. */
  titleAny: string[];
  /** LIKE patterns on the folded title; all must match (multi-word queries). Empty = unused. */
  titleAll: string[];
  /** LIKE patterns on artist names (normalized and folded display). */
  artistAny: string[];
  artistPhoneticAny: string[];
  venueAny: string[];
  cityAny: string[];
  fuzzyThreshold: number;
  nearMissThreshold: number;
  filters: {
    city: string | null;
    from: Date | null;
    to: Date | null;
    type: EventType | null;
    /** A festival may be typed "concert" by a source; its title still says "fest". */
    typeTitlePattern: string | null;
    genreAny: string[];
    /** `normalizeArtistName` of the explicit artist filter. */
    artistKey: string | null;
  };
};

const startPatterns = (v: string) => [`${v}%`, `% ${v}%`];

export function planSearch(q: SearchQuery): SearchPlan {
  const hasText = q.text !== "";
  const variants = [...new Set([q.text, splitAlnum(q.text)])];
  const aliasPatterns = q.aliasTargets.map((t) => `%${t}%`);
  const f = q.filters;
  return {
    hasText,
    fuzzy: hasText && !q.short,
    text: q.text,
    phonetic: q.phonetic,
    artistKey: q.artistKey,
    artistPhonetic: q.artistPhonetic,
    venueKey: q.venueKey,
    titleAny: !hasText
      ? []
      : q.short
        ? [...variants.flatMap(startPatterns), ...aliasPatterns]
        : [...variants.map((v) => `%${v}%`), ...aliasPatterns],
    titleAll: hasText && !q.short && q.tokens.length > 1 ? q.tokens.map((t) => `%${t}%`) : [],
    artistAny: !hasText ? [] : q.short ? [`${q.text}%`] : startPatterns(q.artistKey),
    artistPhoneticAny: hasText && !q.short ? startPatterns(q.artistPhonetic) : [],
    venueAny: !hasText ? [] : q.short ? [`${q.text}%`] : startPatterns(q.venueKey),
    cityAny: hasText ? [`${q.text}%`] : [],
    fuzzyThreshold: FUZZY_THRESHOLD,
    nearMissThreshold: NEAR_MISS_THRESHOLD,
    filters: {
      city: f.city ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      type: f.type ?? null,
      typeTitlePattern: f.type === "festival" ? "%fest%" : null,
      genreAny: f.genre ? (GENRES[f.genre]?.matches ?? [f.genre]).map((m) => `%${m}%`) : [],
      artistKey: f.artist ? normalizeArtistName(f.artist) : null,
    },
  };
}

// ── Candidates and results ────────────────────────────────────────────────

export type SuggestionCandidate = {
  id: string;
  title: string;
  type: EventType;
  startsAt: Date;
  startsAtDateOnly: boolean;
  city: string | null;
  venueName: string | null;
  venueNormalizedName: string | null;
  /** Best of plain and phonetic `word_similarity(query, title)`. */
  titleSimilarity: number;
  venueSimilarity: number;
  trendScore: number;
  trendUpdatedAt: Date;
  /** The lineup artist that best matches the query (or the artist filter), if any. */
  artist: { name: string; normalizedName: string; similarity: number; isFilter: boolean } | null;
};

export type ArtistCandidate = {
  id: string;
  name: string;
  normalizedName: string;
  spotifyId: string | null;
  imageUrl: string | null;
  similarity: number;
  isFilter: boolean;
  upcomingCount: number;
  /** The single upcoming show when there's exactly one (QA-F-1), else null. */
  onlyEventId: string | null;
};

export type CityCandidate = { city: string; upcomingCount: number };

export type MatchReason = "title" | "alias" | "artist" | "venue" | "city" | "fuzzy";

export type Suggestion = {
  id: string;
  title: string;
  type: EventType;
  startsAt: Date;
  startsAtDateOnly: boolean;
  city: string | null;
  venueName: string | null;
  matchReason: MatchReason;
  /** Text to highlight: a span of the title, or the artist / venue / city / filter words. */
  matchedText: string;
  matchedArtist?: string;
};

/** An event as listed in results, fallbacks and sections. */
export type EventResult = Omit<Suggestion, "matchReason" | "matchedText" | "matchedArtist">;

/** `spotifyId` / `imageUrl` are omitted (not null) when unknown. */
export type ArtistEntity = {
  id: string;
  name: string;
  spotifyId?: string;
  imageUrl?: string;
  upcomingCount: number;
  matchedText: string;
  /** With exactly one upcoming show: that event, so the artist row opens it directly (QA-F-1). */
  onlyEventId?: string;
};

export type CityEntity = { city: string; upcomingCount: number };

type Match = { tier: number; reason: MatchReason; matchedText: string; matchedArtist?: string };

/** Lower ranks first (D-042/D-047); inside a tier, trend then date decide. */
export const TIER = {
  titlePrefix: 0,
  titleWordStart: 1,
  titleSubstring: 2,
  alias: 3,
  artist: 4,
  place: 5,
  phonetic: 6,
  fuzzy: 7,
} as const;

const foldedTitle = (title: string) =>
  compactAlnum(foldText(title).split(" ").filter(Boolean)).join(" ");
const startsWord = (haystack: string, needle: string) =>
  needle !== "" && (haystack.startsWith(needle) || haystack.includes(` ${needle}`));

/** The best reason this event matches, or null if it doesn't. */
export function classifyMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  if (q.text === "") return filterMatch(q, c);
  return (
    titleMatch(q, c) ??
    aliasMatch(q, c) ??
    artistMatch(q, c) ??
    placeMatch(q, c) ??
    phoneticTitleMatch(q, c) ??
    fuzzyMatch(q, c)
  );
}

/** No free text: every candidate already passed the filters. */
function filterMatch(q: SearchQuery, c: SuggestionCandidate): Match {
  if (c.artist?.isFilter) {
    return {
      tier: TIER.artist,
      reason: "artist",
      matchedText: c.artist.name,
      matchedArtist: c.artist.name,
    };
  }
  if (q.filters.city && c.city) return { tier: TIER.place, reason: "city", matchedText: c.city };
  // Date/type/genre only: the filter chips explain it; "title" with nothing to highlight
  // keeps the published MatchReason set (D-042) unchanged.
  return { tier: TIER.place, reason: "title", matchedText: "" };
}

function titleMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  const folded = foldedTitle(c.title);
  const at = folded.indexOf(q.text);
  const span = () => titleSpan(c.title, q.text) ?? q.text;
  if (at === 0) return { tier: TIER.titlePrefix, reason: "title", matchedText: span() };
  if (at > 0 && folded[at - 1] === " ")
    return { tier: TIER.titleWordStart, reason: "title", matchedText: span() };
  if (q.tokens.length > 1 && q.tokens.every((t) => startsWord(folded, t))) {
    const first = q.tokens[0]!;
    return {
      tier: TIER.titleWordStart,
      reason: "title",
      matchedText: titleSpan(c.title, first) ?? first,
    };
  }
  if (at > 0 && !q.short)
    return { tier: TIER.titleSubstring, reason: "title", matchedText: span() };
  return null;
}

function aliasMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  const folded = foldedTitle(c.title);
  const target = q.aliasTargets.find((t) => folded.includes(t));
  if (target === undefined) return null;
  return { tier: TIER.alias, reason: "alias", matchedText: titleSpan(c.title, target) ?? target };
}

/**
 * Short queries match only the start of the artist's full name ("lo" isn't "The Local
 * Train"). Longer ones match any word start, also phonetically ("diljeet" → "Diljit").
 */
export function artistDirect(q: SearchQuery, name: string, normalizedName: string): boolean {
  if (q.text === "") return false;
  if (q.short) return foldText(name).startsWith(q.text);
  return (
    startsWord(normalizedName, q.artistKey) ||
    startsWord(phoneticKey(normalizedName), q.artistPhonetic)
  );
}

/** Typo-tolerant name match: trigram similarity from SQL, or phonetic word similarity here. */
export function artistFuzzy(q: SearchQuery, normalizedName: string, similarity: number): boolean {
  if (q.short || q.text === "") return false;
  return (
    similarity >= FUZZY_THRESHOLD ||
    phoneticNameSimilarity(q.artistKey, normalizedName) >= NAME_MATCH_THRESHOLD
  );
}

function artistMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  const a = c.artist;
  if (!a) return null;
  const direct = artistDirect(q, a.name, a.normalizedName);
  if (!direct && !artistFuzzy(q, a.normalizedName, a.similarity)) return null;
  return {
    tier: direct ? TIER.artist : TIER.fuzzy,
    reason: "artist",
    matchedText: a.name,
    matchedArtist: a.name,
  };
}

function placeMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  if (c.venueName && c.venueNormalizedName) {
    const direct = q.short
      ? foldText(c.venueName).startsWith(q.text)
      : startsWord(c.venueNormalizedName, q.venueKey) || c.venueSimilarity >= FUZZY_THRESHOLD;
    if (direct) return { tier: TIER.place, reason: "venue", matchedText: c.venueName };
  }
  if (c.city && normalizeCity(c.city).startsWith(q.text)) {
    return { tier: TIER.place, reason: "city", matchedText: c.city };
  }
  return null;
}

function phoneticTitleMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  if (q.short || !startsWord(phoneticKey(foldedTitle(c.title)), q.phonetic)) return null;
  return { tier: TIER.phonetic, reason: "fuzzy", matchedText: closestTitleWord(c.title, q) };
}

function fuzzyMatch(q: SearchQuery, c: SuggestionCandidate): Match | null {
  if (q.short || c.titleSimilarity < FUZZY_THRESHOLD) return null;
  return { tier: TIER.fuzzy, reason: "fuzzy", matchedText: closestTitleWord(c.title, q) };
}

/** Ranks and de-duplicates (best reason wins). Inside a tier: trend, then the soonest. */
export function rankSuggestions(
  q: SearchQuery,
  candidates: readonly SuggestionCandidate[],
  now: Date,
): Suggestion[] {
  const best = new Map<string, { c: SuggestionCandidate; m: Match; trend: number }>();
  for (const c of candidates) {
    const m = classifyMatch(q, c);
    if (!m) continue;
    const seen = best.get(c.id);
    if (!seen || m.tier < seen.m.tier) {
      best.set(c.id, { c, m, trend: decayedTrend(c.trendScore, c.trendUpdatedAt, now) });
    }
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        a.m.tier - b.m.tier ||
        b.trend - a.trend ||
        a.c.startsAt.getTime() - b.c.startsAt.getTime() ||
        a.c.title.localeCompare(b.c.title) ||
        a.c.id.localeCompare(b.c.id),
    )
    .map(({ c, m }) => ({
      ...toEventResult(c),
      matchReason: m.reason,
      matchedText: m.matchedText,
      ...(m.matchedArtist === undefined ? {} : { matchedArtist: m.matchedArtist }),
    }));
}

/**
 * A listed (not matched) event, for fallbacks and recommendation sections. Clients parse
 * every event row with the same shape, so it carries a neutral reason and no highlight.
 */
export function asListing(e: EventResult): Suggestion {
  return { ...toEventResult(e), matchReason: "title", matchedText: "" };
}

export function toEventResult(c: EventResult): EventResult {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    startsAt: c.startsAt,
    startsAtDateOnly: c.startsAtDateOnly,
    city: c.city,
    venueName: c.venueName,
  };
}

/** Artists with upcoming shows that match the query (or the artist filter), best first. */
export function rankArtists(
  q: SearchQuery,
  candidates: readonly ArtistCandidate[],
): ArtistEntity[] {
  return candidates
    .map((a) => ({ a, direct: a.isFilter || artistDirect(q, a.name, a.normalizedName) }))
    .filter(
      ({ a, direct }) =>
        a.upcomingCount > 0 && (direct || artistFuzzy(q, a.normalizedName, a.similarity)),
    )
    .sort(
      (x, y) =>
        Number(y.a.isFilter) - Number(x.a.isFilter) ||
        Number(y.direct) - Number(x.direct) ||
        y.a.upcomingCount - x.a.upcomingCount ||
        x.a.name.localeCompare(y.a.name),
    )
    .slice(0, ENTITY_LIMIT)
    .map(({ a }) => ({
      id: a.id,
      name: a.name,
      ...(a.spotifyId ? { spotifyId: a.spotifyId } : {}),
      ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}),
      upcomingCount: a.upcomingCount,
      matchedText: (q.text && titleSpan(a.name, q.text)) || a.name,
      ...(a.upcomingCount === 1 && a.onlyEventId ? { onlyEventId: a.onlyEventId } : {}),
    }));
}

/** The filtered city, plus cities whose name starts with the query ("pun" → Pune). */
export function rankCities(q: SearchQuery, candidates: readonly CityCandidate[]): CityEntity[] {
  const isFilter = (c: CityCandidate) => c.city === q.filters.city;
  return candidates
    .filter(
      (c) =>
        c.upcomingCount > 0 &&
        (isFilter(c) || (q.text !== "" && normalizeCity(c.city).startsWith(q.text))),
    )
    .sort(
      (a, b) =>
        Number(isFilter(b)) - Number(isFilter(a)) ||
        b.upcomingCount - a.upcomingCount ||
        a.city.localeCompare(b.city),
    )
    .slice(0, ENTITY_LIMIT)
    .map(({ city, upcomingCount }) => ({ city, upcomingCount }));
}

/** The closest near miss (artist name or event title) when nothing matched, else undefined. */
export function didYouMean(
  q: SearchQuery,
  events: readonly SuggestionCandidate[],
  artists: readonly ArtistCandidate[],
): string | undefined {
  if (q.text === "" || q.short) return undefined;
  const near = (s: number) => s >= NEAR_MISS_THRESHOLD;
  const options = [
    ...artists
      .filter((a) => a.upcomingCount > 0 && near(a.similarity))
      .map((a) => ({ text: a.name, score: a.similarity })),
    ...events
      .filter((e) => near(e.titleSimilarity))
      .map((e) => ({ text: e.title, score: e.titleSimilarity })),
  ].sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  return options[0]?.text;
}

// ── Highlight spans ───────────────────────────────────────────────────────

/**
 * Folds `original` character by character, keeping where each folded character came from,
 * so a match in the folded text maps back to the exact original span ("Beyoncé" for "beyonce").
 */
function foldWithMap(original: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  const push = (s: string, i: number) => {
    for (const ch of s) {
      if (ch === " " && (folded === "" || folded.endsWith(" "))) continue;
      folded += ch;
      from.push(i);
    }
  };
  for (let i = 0; i < original.length; i++) {
    const ch = original[i]!;
    // Same rules as foldText: apostrophes and periods vanish, other punctuation is a space.
    if (/['’`.]/u.test(ch)) continue;
    push(foldText(ch) || " ", i);
  }
  while (folded.endsWith(" ")) {
    folded = folded.slice(0, -1);
    from.pop();
  }
  return { folded, from };
}

/** The original-text span whose folded form equals `needle`, or null. */
export function titleSpan(title: string, needle: string): string | null {
  const { folded, from } = foldWithMap(title);
  const at = folded.indexOf(needle);
  if (at < 0 || needle === "") return null;
  const start = from[at]!;
  const end = from[at + needle.length - 1]! + 1;
  return title.slice(start, end);
}

/** For fuzzy matches: the title word closest to any query token. */
function closestTitleWord(title: string, q: SearchQuery): string {
  let best = { word: title, score: -1 };
  for (const word of title.split(/\s+/u)) {
    const key = foldText(word);
    if (key === "") continue;
    for (const token of q.tokens) {
      const score = Math.max(
        jaroWinkler(token, key),
        jaroWinkler(phoneticKey(token), phoneticKey(key)),
      );
      if (score > best.score) best = { word, score };
    }
  }
  return best.word;
}

/** True when the event is in the visitor's own city. */
export function inHomeCity(eventCity: string | null, homeCity: string): boolean {
  return eventCity !== null && canonicalCity(eventCity) === canonicalCity(homeCity);
}

/** City-first: the visitor's city matches first, the rest after, each keeping its rank order. */
export function cityFirst<T extends { city: string | null }>(
  ranked: readonly T[],
  homeCity: string,
): { items: T[]; inCity: number } {
  const here = ranked.filter((r) => inHomeCity(r.city, homeCity));
  const rest = ranked.filter((r) => !inHomeCity(r.city, homeCity));
  return { items: [...here, ...rest], inCity: here.length };
}

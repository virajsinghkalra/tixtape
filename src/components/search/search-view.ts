/** Pure presentation rules for the search journey (D-048). No React, no IO. */
import { plural } from "../lineup-copy";
import type {
  ArtistEntity,
  CityEntity,
  EventResult,
  RecommendationSection,
  SearchFilters,
  SuggestResponse,
} from "./types";

export type SearchOption =
  | { kind: "artist"; key: string; artist: ArtistEntity }
  | { kind: "city"; key: string; city: CityEntity }
  | { kind: "event"; key: string; event: EventResult }
  | { kind: "query"; key: string; query: string };

export type OptionGroup = { id: string; label: string; options: SearchOption[] };

/** Artists, then Cities, then Events (D-048). Fallback events are shown separately as links. */
export function buildGroups(r: SuggestResponse): OptionGroup[] {
  const groups: OptionGroup[] = [
    {
      id: "artists",
      label: "Artists",
      options: r.artists.map((a) => ({ kind: "artist", key: `a:${a.name}`, artist: a })),
    },
    {
      id: "cities",
      label: "Cities",
      options: r.cities.map((c) => ({ kind: "city", key: `c:${c.city}`, city: c })),
    },
    {
      id: "events",
      label: "Events",
      options: r.results.map((e) => ({ kind: "event", key: `e:${e.id}`, event: e })),
    },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/** Instant results before the server answers: recent searches and cached picks by prefix. */
export function localMatches(
  query: string,
  recent: readonly string[],
  sections: readonly RecommendationSection[],
): OptionGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const startsWord = (text: string) =>
    text
      .toLowerCase()
      .split(/[\s\-()]+/)
      .some((w) => w.startsWith(q)) || text.toLowerCase().startsWith(q);
  const queries = recent.filter((r) => r.toLowerCase() !== q && startsWord(r)).slice(0, 3);
  const seen = new Set<string>();
  const events = sections
    .flatMap((s) => s.items ?? [])
    .filter((e) => startsWord(e.title) && !seen.has(e.id) && seen.add(e.id))
    .slice(0, 5);
  return [
    {
      id: "recent",
      label: "Recent",
      options: queries.map((query): SearchOption => ({ kind: "query", key: `q:${query}`, query })),
    },
    {
      id: "events",
      label: "Events",
      options: events.map((e): SearchOption => ({
        kind: "event",
        key: `e:${e.id}`,
        event: { ...e, matchReason: "title", matchedText: query.trim() },
      })),
    },
  ].filter((g) => g.options.length > 0);
}

/** The rest of the top title when it starts with what's typed: lolla → "palooza India 2027". */
export function ghostCompletion(value: string, top: EventResult | undefined): string {
  if (!top || value.trim().length < 2 || value !== value.trimStart()) return "";
  return top.title.toLowerCase().startsWith(value.toLowerCase())
    ? top.title.slice(value.length)
    : "";
}

export type FilterChip = { key: keyof SearchFilters; emoji: string; label: string };

const MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

export function filterChips(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.city) chips.push({ key: "city", emoji: "📍", label: filters.city });
  if (filters.from || filters.to) {
    const from = filters.from ? MONTH.format(new Date(filters.from)) : "";
    const to = filters.to ? MONTH.format(new Date(filters.to)) : "";
    chips.push({
      key: "from",
      emoji: "📅",
      label: from && to && from !== to ? `${from} – ${to}` : from || to,
    });
  }
  if (filters.type) {
    const festival = filters.type === "festival";
    chips.push({
      key: "type",
      emoji: festival ? "🎪" : "🎤",
      label: festival ? "Festivals" : "Concerts",
    });
  }
  if (filters.genre) chips.push({ key: "genre", emoji: "🎸", label: filters.genre });
  return chips;
}

const DATE_WORDS =
  /\b(this weekend|next weekend|weekend|tonight|today|tomorrow|this month|next month|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|20\d\d)\b/gi;
const TYPE_WORDS = /\b(festivals?|concerts?|gigs?|shows?)\b/gi;

/** Removing a chip removes the words that created it from the query ("gigs in pune" − Pune). */
export function withoutFilter(
  query: string,
  key: FilterChip["key"],
  filters: SearchFilters,
): string {
  let next = query;
  if (key === "city" && filters.city) {
    next = next.replace(new RegExp(`\\b(in\\s+)?${escapeRegExp(filters.city)}\\b`, "gi"), "");
  } else if (key === "from" || key === "to") {
    next = next.replace(DATE_WORDS, "");
  } else if (key === "type") {
    next = next.replace(TYPE_WORDS, "");
  } else if (key === "genre" && filters.genre) {
    next = next.replace(new RegExp(`\\b${escapeRegExp(filters.genre)}\\b`, "gi"), "");
  }
  return next.replace(/\s+/g, " ").trim();
}

/** Artist with one upcoming show → that event, artist highlighted; 2+ shows → their list. */
export function artistHref(artist: ArtistEntity, results: readonly EventResult[]): string {
  const theirs = results.filter(
    (r) => r.matchedArtist?.toLowerCase() === artist.name.toLowerCase(),
  );
  if (artist.upcomingCount === 1 && theirs.length === 1) {
    return `/events/${theirs[0]!.id}?artist=${encodeURIComponent(artist.name)}`;
  }
  return `/search?artist=${encodeURIComponent(artist.name)}`;
}

export function cityHref(city: string): string {
  return `/search?city=${encodeURIComponent(city)}`;
}

/** Why a row matched: "Ritviz plays here", "in Mumbai", "at Palace Grounds", "Close match". */
export function reasonLabel(e: EventResult): string | null {
  switch (e.matchReason) {
    case "artist":
      return e.matchedArtist ? `${e.matchedArtist} plays here` : "Artist match";
    case "city":
      return e.city ? `in ${e.city}` : null;
    case "venue":
      return e.venueName ? `at ${e.venueName}` : null;
    case "alias":
      return e.matchedText && e.matchedText.toLowerCase() !== e.title.toLowerCase()
        ? `aka ${e.matchedText}`
        : null;
    case "fuzzy":
      return "Close match";
    case "title":
      return null;
  }
}

export function upcomingLabel(n: number): string {
  return plural(n, "upcoming show");
}

/** Flat keyboard order across groups. */
export function flatten(groups: readonly OptionGroup[]): SearchOption[] {
  return groups.flatMap((g) => g.options);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

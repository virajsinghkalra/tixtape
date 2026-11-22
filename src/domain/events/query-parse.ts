/**
 * Query understanding for search (D-047 §2): turns "gigs in pune this weekend" into
 * free text plus filters. Pure; `now` is injected for date words (IST).
 */
import type { EventType } from "@/domain/shared/lineup";
import {
  dayWindow,
  istDay,
  monthWindow,
  upcomingMonthWindow,
  weekendWindow,
  yearWindow,
  type DateWindow,
} from "./ist-calendar";
import { foldText } from "./text";
import { knownCity } from "./venue";

export type SearchFilters = {
  /** Canonical city ("Mumbai"). */
  city?: string;
  from?: Date;
  to?: Date;
  type?: EventType;
  /** Canonical genre key from `GENRES`. */
  genre?: string;
  /** Artist display name as given (explicit `artist=` filter only). */
  artist?: string;
};

export type ParsedQuery = {
  /** Free text left after filters are taken out: folded, letters+digits compacted. */
  text: string;
  tokens: string[];
  filters: SearchFilters;
  /** The words that became date/type/genre filters ("this weekend festival"), or null. */
  filterLabel: string | null;
};

/** Words that carry no meaning in a search. Prepositions also mark a following city. */
/** QA-F-4: "concerts", "gigs" and "shows" mean any live event, festivals included. */
const FILLER = new Set([
  "concert",
  "concerts",
  "gig",
  "gigs",
  "show",
  "shows",
  "event",
  "events",
  "live",
  "ticket",
  "tickets",
  // Question-style English and Hinglish ("jalandhar mei konsa show hai", "any gigs in pune").
  "any",
  "which",
  "whats",
  "konsa",
  "kaunsa",
  "konse",
  "kaunse",
  "kon",
  "kaun",
  "hai",
  "hain",
  "kya",
  "kab",
  "kahan",
  "kidhar",
  "mei",
  "mein",
  "baaki",
  "baki",
  "sab",
  "saare",
  "sare",
  "koi",
  "wala",
  "wale",
  "wali",
]);
/** "upcoming", "soon": everything still to come, soonest first. */
const UPCOMING_WORDS = new Set(["upcoming", "soon"]);
const UPCOMING_SPAN_MS = 400 * 86_400_000;
const PREPOSITIONS = new Set(["in", "at", "near"]);
const TYPE_WORDS: Readonly<Record<string, EventType>> = {
  festival: "festival",
  festivals: "festival",
};

/**
 * Genre words → the canonical genre, and what that genre looks like in `events.genre`
 * (Ticketmaster says "Dance/Electronic", "Hip-Hop/Rap"). Data: extend freely.
 */
export const GENRES: Readonly<Record<string, { words: string[]; matches: string[] }>> = {
  edm: { words: ["edm", "electronic"], matches: ["edm", "electronic", "dance"] },
  techno: { words: ["techno"], matches: ["techno"] },
  indie: { words: ["indie"], matches: ["indie"] },
  "hip hop": { words: ["hip hop", "hiphop", "rap"], matches: ["hip hop", "rap"] },
  punjabi: { words: ["punjabi"], matches: ["punjabi", "bhangra"] },
  bollywood: { words: ["bollywood"], matches: ["bollywood", "filmi"] },
  rock: { words: ["rock"], matches: ["rock"] },
  jazz: { words: ["jazz"], matches: ["jazz"] },
  metal: { words: ["metal"], matches: ["metal"] },
};

const MONTHS: Readonly<Record<string, number>> = Object.fromEntries(
  [
    ["january", "jan"],
    ["february", "feb"],
    ["march", "mar"],
    ["april", "apr"],
    ["may"],
    ["june", "jun"],
    ["july", "jul"],
    ["august", "aug"],
    ["september", "sep", "sept"],
    ["october", "oct"],
    ["november", "nov"],
    ["december", "dec"],
  ].flatMap((names, month) => names.map((n) => [n, month] as const)),
);

const isYear = (t: string) => /^20\d{2}$/u.test(t);

/** "nh 7" → "nh7", "vh 1" → "vh1": a 1–3 letter word followed by a 1–2 digit number. */
export function compactAlnum(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^\p{L}{1,3}$/u.test(prev) && /^\d{1,2}$/u.test(t)) {
      out[out.length - 1] = prev + t;
    } else out.push(t);
  }
  return out;
}

/** The other spelling of compacted tokens: "nh7 weekender" → "nh 7 weekender". */
export function splitAlnum(text: string): string {
  return text
    .split(" ")
    .map((t) => t.replace(/^(\p{L}{1,3})(\d{1,2})$/u, "$1 $2"))
    .join(" ");
}

type Segment =
  | { kind: "free" | "filler" | "prep"; words: string[] }
  | { kind: "date"; words: string[]; window: DateWindow; monthOnly?: number; year?: number }
  | { kind: "type"; words: string[]; type: EventType }
  | { kind: "genre"; words: string[]; genre: string }
  | { kind: "city"; words: string[]; city: string };

const GENRE_PHRASES = new Map(
  Object.entries(GENRES).flatMap(([genre, g]) => g.words.map((w) => [w, genre] as const)),
);

function dateAt(tokens: string[], i: number, now: Date): Segment | null {
  const one = tokens[i]!;
  const two = `${one} ${tokens[i + 1] ?? ""}`;
  const fixed: Record<string, () => DateWindow> = {
    "this weekend": () => weekendWindow(now),
    "next weekend": () => weekendWindow(now, 1),
    "this month": () => {
      const d = istDay(now);
      return monthWindow(d.year, d.month);
    },
    "next month": () => {
      const d = istDay(now);
      return monthWindow(d.year, d.month + 1);
    },
  };
  if (fixed[two]) return { kind: "date", words: two.split(" "), window: fixed[two]() };
  if (one === "today" || one === "tonight")
    return { kind: "date", words: [one], window: dayWindow(now, 0) };
  if (one === "tomorrow") return { kind: "date", words: [one], window: dayWindow(now, 1) };
  if (UPCOMING_WORDS.has(one)) {
    return {
      kind: "date",
      words: [one],
      window: { from: now, to: new Date(now.getTime() + UPCOMING_SPAN_MS) },
    };
  }
  if (one === "weekend") return { kind: "date", words: [one], window: weekendWindow(now) };
  const month = MONTHS[one];
  if (month !== undefined) {
    return {
      kind: "date",
      words: [one],
      window: upcomingMonthWindow(now, month),
      monthOnly: month,
    };
  }
  if (isYear(one))
    return { kind: "date", words: [one], window: yearWindow(Number(one)), year: Number(one) };
  return null;
}

function cityAt(tokens: string[], i: number): Segment | null {
  for (let n = 3; n >= 1; n--) {
    if (i + n > tokens.length) continue;
    const words = tokens.slice(i, i + n);
    const city = knownCity(words.join(" "));
    if (city) return { kind: "city", words, city };
  }
  return null;
}

function genreAt(tokens: string[], i: number): Segment | null {
  for (const n of [2, 1]) {
    const words = tokens.slice(i, i + n);
    const genre = words.length === n ? GENRE_PHRASES.get(words.join(" ")) : undefined;
    if (genre) return { kind: "genre", words, genre };
  }
  return null;
}

function segment(tokens: string[], now: Date): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < tokens.length;) {
    const t = tokens[i]!;
    const seg: Segment =
      dateAt(tokens, i, now) ??
      (TYPE_WORDS[t] ? { kind: "type", words: [t], type: TYPE_WORDS[t] } : null) ??
      cityAt(tokens, i) ??
      genreAt(tokens, i) ??
      (PREPOSITIONS.has(t) ? { kind: "prep", words: [t] } : null) ??
      (FILLER.has(t) ? { kind: "filler", words: [t] } : { kind: "free", words: [t] });
    out.push(seg);
    i += seg.words.length;
  }
  return out;
}

/** Month + year typed together ("december 2027") narrow to that month of that year. */
function dateFilter(segments: Segment[]): DateWindow | undefined {
  const dates = segments.filter((s) => s.kind === "date");
  const month = dates.find((s) => s.monthOnly !== undefined);
  const year = dates.find((s) => s.year !== undefined);
  if (month?.monthOnly !== undefined && year?.year !== undefined) {
    return monthWindow(year.year, month.monthOnly);
  }
  const narrow = dates.filter((s) => !s.words.some((w) => UPCOMING_WORDS.has(w)));
  return (narrow[narrow.length - 1] ?? dates[dates.length - 1])?.window;
}

/**
 * A city becomes a filter when it follows "in/at/near", ends the query, or is all that's
 * left: "lolla mumbai", "gigs in pune". "Bombay Bicycle Club" stays text.
 * A genre becomes a filter only when nothing else is left ("edm", "punjabi in delhi"),
 * so "bollywood night" still matches the title "100% Bollywood Night".
 */
export function parseSearchText(raw: string, now: Date): ParsedQuery {
  const all = compactAlnum(foldText(raw).split(" ").filter(Boolean));
  const segments = segment(all, now);
  const lastMeaningful = segments.findLastIndex((s) => s.kind === "free" || s.kind === "city");
  const keepCity = (s: Segment, i: number) =>
    segments[i - 1]?.kind === "prep" || i === lastMeaningful;
  const resolved: Segment[] = segments.map((s, i) =>
    s.kind === "city" && !keepCity(s, i) ? { kind: "free", words: s.words } : s,
  );
  const hasFree = resolved.some((s) => s.kind === "free");
  const final = resolved.map((s) =>
    s.kind === "genre" && hasFree ? ({ kind: "free", words: s.words } as Segment) : s,
  );

  const filters: SearchFilters = {};
  const window = dateFilter(final);
  if (window) Object.assign(filters, window);
  for (const s of final) {
    if (s.kind === "city") filters.city = s.city;
    if (s.kind === "type") filters.type = s.type;
    if (s.kind === "genre") filters.genre = s.genre;
  }
  const label = final
    .filter((s) => s.kind === "date" || s.kind === "type" || s.kind === "genre")
    .flatMap((s) => s.words)
    .join(" ");
  const tokens = final.filter((s) => s.kind === "free").flatMap((s) => s.words);
  // Only filler ("live", "in"): search the words as typed rather than nothing.
  if (tokens.length === 0 && Object.keys(filters).length === 0) {
    return { text: all.join(" "), tokens: all, filters, filterLabel: null };
  }
  return { text: tokens.join(" "), tokens, filters, filterLabel: label || null };
}

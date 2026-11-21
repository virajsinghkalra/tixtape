/**
 * Event dedupe (P1.5, LLD §5.3). Pure: callers fetch candidates in the same block
 * (see `blockingWindow`) and this module scores and decides.
 */
import type { EventSource } from "@/domain/shared/lineup";
import { diceOverlap, jaccard } from "./similarity";
import { istDay } from "./ist-calendar";
import { foldText } from "./text";
import { normalizeCity, venueSimilarity } from "./venue";

export type DedupeSubject = {
  title: string;
  startsAt: Date;
  /** ISO 3166-1 alpha-2. */
  country: string;
  city: string;
  venueName: string | null;
  /** Normalized artist names (or artist IDs; use the same kind on both sides). */
  artistKeys: readonly string[];
  /** The source gave only a date (D-034). Unknown counts as timed: the stricter reading. */
  startsAtDateOnly?: boolean;
  /** Sources behind this record: the incoming source, or every source of a stored event. */
  sources?: readonly EventSource[];
};

export type DedupeDecision = "merge" | "review" | "new";

export const MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.6;

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);

/** Start of the UTC day before `startsAt` to the end of the UTC day after it: the ±1 day block. */
export function blockingWindow(startsAt: Date): { from: Date; to: Date } {
  const day = utcDay(startsAt);
  return { from: new Date((day - 1) * DAY_MS), to: new Date((day + 2) * DAY_MS - 1) };
}

/** Blocking key: same country, same normalized city, start dates at most one UTC day apart. */
export function sameBlock(a: DedupeSubject, b: DedupeSubject): boolean {
  return (
    a.country.toUpperCase() === b.country.toUpperCase() &&
    normalizeCity(a.city) === normalizeCity(b.city) &&
    Math.abs(utcDay(a.startsAt) - utcDay(b.startsAt)) <= 1
  );
}

/** Words that vary between editions of the same event and say nothing about identity. */
const EDITION_WORDS = new Set(["edition", "vol", "volume", "season", "chapter", "the"]);
const isEditionToken = (t: string) =>
  EDITION_WORDS.has(t) || /^\d+$/u.test(t) || /^\d+(st|nd|rd|th)$/u.test(t);

/** "Lollapalooza India 2026 – 4th Edition" → ["lollapalooza", "india"]. */
export function eventNameTokens(title: string): string[] {
  return foldText(title)
    .split(" ")
    .filter((t) => t !== "" && !isEditionToken(t));
}

/** "TBA", "Venue TBD", "To be announced": a placeholder says nothing about where (D-072). */
const PLACEHOLDER_VENUE =
  /^(?:venue\s*)?(?:tba|tbd|tbc|to be (?:announced|decided|confirmed)|unknown|n\s*a|secret location)(?:\s*venue)?$/u;

export function isPlaceholderVenue(name: string | null): boolean {
  return name === null || PLACEHOLDER_VENUE.test(foldText(name));
}

/**
 * 0.4 × venue similarity + 0.3 × title token overlap + 0.3 × lineup Jaccard.
 * Each part scores 0 when either side has nothing to compare (no venue or a placeholder
 * like "TBA", empty lineup).
 */
export function duplicateScore(a: DedupeSubject, b: DedupeSubject): number {
  const venue =
    !isPlaceholderVenue(a.venueName) && !isPlaceholderVenue(b.venueName)
      ? venueSimilarity(a.venueName!, b.venueName!, a.city)
      : 0;
  const title = diceOverlap(eventNameTokens(a.title), eventNameTokens(b.title));
  const artists = jaccard(a.artistKeys, b.artistKeys);
  return 0.4 * venue + 0.3 * title + 0.3 * artists;
}

export function decide(score: number): DedupeDecision {
  if (score >= MERGE_THRESHOLD) return "merge";
  if (score >= REVIEW_THRESHOLD) return "review";
  return "new";
}

/**
 * D-072: may these two records be merged at all, regardless of score?
 * - Same local (IST) date: yes, scoring decides.
 * - Different local dates, both with a confirmed time, and one source behind both (or an
 *   admin on either side): never. That is a residency or a tour, not a duplicate.
 * - Different local dates otherwise (two sources, or a date-only listing): at most "review".
 *   The ±1 day block exists for a source's timezone or date slip, which a person confirms.
 */
export type MergeGuard = "allow" | "review" | "never";

const localDateKey = (d: Date) => {
  const { year, month, day } = istDay(d);
  return `${year}-${month}-${day}`;
};

export function mergeGuard(a: DedupeSubject, b: DedupeSubject): MergeGuard {
  if (localDateKey(a.startsAt) === localDateKey(b.startsAt)) return "allow";
  const bothTimed = a.startsAtDateOnly !== true && b.startsAtDateOnly !== true;
  const aSources = a.sources ?? [];
  const bSources = b.sources ?? [];
  const sameSource = aSources.some((s) => bSources.includes(s));
  const admin = aSources.includes("admin") || bSources.includes("admin");
  if (bothTimed && (sameSource || admin)) return "never";
  return "review";
}

export type DuplicateMatch<T> =
  | { decision: "merge" | "review"; candidate: T; score: number }
  | { decision: "new"; candidate: null; score: number };

/** Best-scoring candidate in the same block, and what to do with it. */
export function findDuplicate<T extends DedupeSubject>(
  incoming: DedupeSubject,
  candidates: readonly T[],
): DuplicateMatch<T> {
  let best: { candidate: T; score: number; guard: MergeGuard } | null = null;
  for (const candidate of candidates) {
    if (!sameBlock(incoming, candidate)) continue;
    const guard = mergeGuard(incoming, candidate);
    if (guard === "never") continue;
    const score = duplicateScore(incoming, candidate);
    if (best === null || score > best.score) best = { candidate, score, guard };
  }
  if (best === null) return { decision: "new", candidate: null, score: 0 };
  const scored = decide(best.score);
  // A different-night pair is never auto-merged (D-072): a person confirms it.
  const decision = scored === "merge" && best.guard === "review" ? "review" : scored;
  if (decision === "new") return { decision, candidate: null, score: best.score };
  return { decision, candidate: best.candidate, score: best.score };
}

/**
 * Natural key for `events.dedupe_key`: normalized title + UTC start date + normalized city.
 * Year and edition words are dropped from the title because the date already pins the edition.
 */
export function dedupeKey(input: { title: string; startsAt: Date; city: string }): string {
  const tokens = eventNameTokens(input.title);
  const title = tokens.length > 0 ? tokens.join(" ") : foldText(input.title);
  const date = input.startsAt.toISOString().slice(0, 10);
  return `${title}|${date}|${normalizeCity(input.city)}`;
}

// ── Source precedence ──────────────────────────────────────────────────────

/** Highest first (LLD §5.3): admin > jambase > ticketmaster > user_submission. */
// D-053: official organiser sources outrank news; every source must be listed here.
export const SOURCE_PRECEDENCE: readonly EventSource[] = [
  "admin",
  "jambase",
  "ticketmaster",
  "sunburn",
  "teaminnovation",
  "artist_site",
  "highape",
  "wikipedia",
  "rollingstone",
  "pollstar",
  "gig_web",
  "web",
  "user_submission",
];

/** Higher is more trusted. */
export function sourceRank(source: EventSource): number {
  const i = SOURCE_PRECEDENCE.indexOf(source);
  // An unlisted source must never outrank admin (indexOf = -1 would rank it highest).
  return i === -1 ? 0 : SOURCE_PRECEDENCE.length - i;
}

/** The most trusted of the sources that have contributed to an event, or null if none. */
export function topSource(sources: readonly EventSource[]): EventSource | null {
  let top: EventSource | null = null;
  for (const s of sources) if (top === null || sourceRank(s) > sourceRank(top)) top = s;
  return top;
}

/** True when `incoming` may overwrite fields set by `existingSources` (same source counts: newer data). */
export function mayOverwrite(
  incoming: EventSource,
  existingSources: readonly EventSource[],
): boolean {
  const top = topSource(existingSources);
  return top === null || sourceRank(incoming) >= sourceRank(top);
}

/**
 * Field-level merge. `undefined` in `incoming` means "unknown" and never changes anything.
 * - When the incoming source may overwrite, its known values win (including `null`, which clears).
 * - Otherwise it only fills fields the existing record has as `null`.
 */
export function mergeEventFields<F extends Record<string, unknown>>(
  existing: F,
  incoming: { [K in keyof F]?: F[K] },
  overwrite: boolean,
): F {
  const merged = { ...existing };
  for (const key of Object.keys(existing) as (keyof F)[]) {
    const value = incoming[key];
    if (value === undefined) continue;
    if (overwrite || existing[key] === null) merged[key] = value as F[keyof F];
  }
  return merged;
}

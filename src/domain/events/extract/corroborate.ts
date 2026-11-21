/**
 * Corroboration (D-024, D-033). Candidates that describe the same event are clustered, and a
 * cluster is published only when:
 *  - two different sources agree on event + date (±1 day) + city and their confirmed artist
 *    sets overlap by at least 70% (of the smaller set), or
 *  - an official source (organiser, festival, Wikipedia edition facts) and a trusted outlet agree.
 * A single source, or sources that disagree on artists, stay unpublished candidates.
 */
import { istDay } from "../ist-calendar";
import { diceOverlap } from "../similarity";
import { eventNameTokens } from "../dedupe";
import { normalizeCity, normalizeVenueName } from "../venue";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { splitLineupCredit } from "../credits";
import type { EventType } from "@/domain/shared/lineup";
import type { CollectorSource, SourceTrust, ValidatedCandidate } from "./candidate";

export const ARTIST_OVERLAP_MIN = 0.7;
/** Title token overlap at which two candidates in the same city and dates name the same event. */
export const TITLE_MATCH_MIN = 0.5;

const DAY_MS = 86_400_000;
const istDayNumber = (d: Date) => {
  const day = istDay(d);
  return Math.round(Date.UTC(day.year, day.month, day.day) / DAY_MS);
};

/** |A ∩ B| / min(|A|, |B|) over normalized names; 0 when either side is empty. */
export function artistOverlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a.map(normalizeArtistName));
  const right = new Set(b.map(normalizeArtistName));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const name of left) if (right.has(name)) shared++;
  return shared / Math.min(left.size, right.size);
}

/**
 * D-078: words that name a kind of night, not a particular one. On their own they make
 * "Techno Night ft. DJ X" look like "Techno Night ft. DJ Y".
 */
export const GENERIC_TITLE_WORDS: ReadonlySet<string> = new Set([
  "night",
  "nights",
  "presents",
  "present",
  "ft",
  "feat",
  "featuring",
  "live",
  "party",
  "club",
  "at",
  "by",
  "with",
  "and",
  "x",
  "vs",
  "b2b",
  "dj",
  "the",
  "of",
  "in",
  "a",
  "show",
  "concert",
  "gig",
  "tour",
  "music",
  "festival",
  "fest",
  "edition",
  "special",
  "experience",
  "session",
  "sessions",
]);

/** Title tokens that can identify an event: no generic words, no venue or city words. */
function identifyingTokens(c: ValidatedCandidate, ignore: ReadonlySet<string>): string[] {
  const place = new Set(
    [...eventNameTokens(c.venueName ?? ""), ...eventNameTokens(c.city)].filter(Boolean),
  );
  return eventNameTokens(c.title).filter(
    (t) => !GENERIC_TITLE_WORDS.has(t) && !place.has(t) && !ignore.has(t),
  );
}

function titleOverlap(
  a: ValidatedCandidate,
  b: ValidatedCandidate,
  ignore: ReadonlySet<string>,
): number {
  const ta = identifyingTokens(a, ignore);
  const tb = identifyingTokens(b, ignore);
  if (ta.length === 0 || tb.length === 0) return 0;
  // A short name fully inside a longer one ("Johnnie & Co. Festival" in "… Music Festival") counts.
  const small = ta.length <= tb.length ? ta : tb;
  const big = new Set(ta.length <= tb.length ? tb : ta);
  const contained = small.every((t) => big.has(t));
  return contained ? 1 : diceOverlap(ta, tb);
}

const TITLE_SEPARATORS = /\s*(?:[|–—:]|\s-\s)\s*/u;
const FEATURING = /\b(?:ft|feat|featuring)\b\.?\s+(.+)$/iu;
const LIVE_AFTER_NAME = /^(.+?)\s+live\b/iu;
const TRAILING_PLACE = /\s+(?:at|@|in)\s+.*$/iu;

/**
 * D-078: who the title says is playing. Names after "ft/feat/featuring", names before
 * "live" ("James Mithal Live at HOD Club"), and the candidate's own artists that appear in
 * the title. Normalized; empty when the title names nobody.
 */
export function titleHeadliners(c: ValidatedCandidate): Set<string> {
  const names = new Set<string>();
  const add = (credit: string) => {
    for (const part of splitLineupCredit(credit.replace(TRAILING_PLACE, ""))) {
      const name = normalizeArtistName(part);
      if (name !== "" && !name.split(" ").every((w) => GENERIC_TITLE_WORDS.has(w))) names.add(name);
    }
  };
  for (const segment of c.title.split(TITLE_SEPARATORS)) {
    const feat = FEATURING.exec(segment);
    if (feat) add(feat[1]!);
    else {
      const live = LIVE_AFTER_NAME.exec(segment);
      if (live) add(live[1]!);
    }
  }
  const folded = ` ${normalizeArtistName(c.title)} `;
  for (const artist of c.artists) {
    const name = normalizeArtistName(artist);
    if (name !== "" && folded.includes(` ${name} `)) names.add(name);
  }
  return names;
}

const disjoint = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size > 0 && b.size > 0 && [...a].every((x) => !b.has(x));

/** The sources agree on who plays: ≥70% overlap, or each one's headliner is on the other's bill. */
function sourcesAgreeOnArtists(a: ValidatedCandidate, b: ValidatedCandidate): boolean {
  if (artistOverlap(a.artists, b.artists) >= ARTIST_OVERLAP_MIN) return true;
  const headA = a.artists[0];
  const headB = b.artists[0];
  if (headA === undefined || headB === undefined) return true;
  const billA = new Set(a.artists.map(normalizeArtistName));
  const billB = new Set(b.artists.map(normalizeArtistName));
  return billB.has(normalizeArtistName(headA)) || billA.has(normalizeArtistName(headB));
}

const sameVenue = (a: ValidatedCandidate, b: ValidatedCandidate) =>
  a.venueName !== null &&
  b.venueName !== null &&
  normalizeVenueName(a.venueName, a.city) === normalizeVenueName(b.venueName, b.city);

/**
 * Same city, start dates at most one IST day apart, and the same name or the same artists.
 * D-078: never when the titles name different headliners, and a different headliner at the
 * same venue on the same IST date is a separate show unless the sources agree on artists.
 * `brandWords` (from `recurringBrandWords`) carry no title similarity.
 */
export function sameEvent(
  a: ValidatedCandidate,
  b: ValidatedCandidate,
  brandWords: ReadonlySet<string> = new Set(),
): boolean {
  if (a.country.toUpperCase() !== b.country.toUpperCase()) return false;
  if (normalizeCity(a.city) !== normalizeCity(b.city)) return false;
  const dayGap = Math.abs(istDayNumber(a.startsAt) - istDayNumber(b.startsAt));
  if (dayGap > 1) return false;
  if (disjoint(titleHeadliners(a), titleHeadliners(b))) return false;
  if (dayGap === 0 && sameVenue(a, b) && !sourcesAgreeOnArtists(a, b)) return false;
  // One listing source, two items, consecutive nights at one venue: two nights, like a
  // residency (D-072). The ±1 day window is for slips *between* sources.
  if (dayGap === 1 && a.source === b.source && a.externalId !== b.externalId && sameVenue(a, b)) {
    return false;
  }
  return (
    titleOverlap(a, b, brandWords) >= TITLE_MATCH_MIN ||
    artistOverlap(a.artists, b.artists) >= ARTIST_OVERLAP_MIN
  );
}

/** A recurring series: the word shows up on at least this many different IST dates… */
const BRAND_MIN_DATES = 3;
/** …spread over at least this many days, so one festival weekend never counts. */
const BRAND_MIN_SPAN_DAYS = 7;

/**
 * D-078: title words that recur across many listings on different dates in the same city:
 * a venue's or promoter's brand ("CROSS/OVER", "HOD"). They can't tell one night from another.
 */
export function recurringBrandWords(candidates: readonly ValidatedCandidate[]): Set<string> {
  const days = new Map<string, Set<number>>();
  for (const c of candidates) {
    const day = istDayNumber(c.startsAt);
    for (const t of new Set(identifyingTokens(c, new Set()))) {
      const key = `${normalizeCity(c.city)}|${t}`;
      days.set(key, (days.get(key) ?? new Set()).add(day));
    }
  }
  const brands = new Set<string>();
  for (const [key, seen] of days) {
    const list = [...seen];
    const span = Math.max(...list) - Math.min(...list);
    if (seen.size >= BRAND_MIN_DATES && span >= BRAND_MIN_SPAN_DAYS) brands.add(key.split("|")[1]!);
  }
  return brands;
}

/** Groups candidates that describe the same event (transitively). Input order is kept. */
export function clusterCandidates(
  candidates: readonly ValidatedCandidate[],
): ValidatedCandidate[][] {
  const brandWords = recurringBrandWords(candidates);
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (sameEvent(candidates[i]!, candidates[j]!, brandWords)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, ValidatedCandidate[]>();
  candidates.forEach((c, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  });
  return [...groups.values()];
}

export type PublishReason = "sources_agree" | "official_and_trusted";
export type PublishDecision =
  | { published: true; reason: PublishReason }
  | { published: false; reason: "single_source" | "no_agreement" };

/** Applies the two publishing rules to one cluster. */
export function decidePublication(cluster: readonly ValidatedCandidate[]): PublishDecision {
  const sources = new Set(cluster.map((c) => c.source));
  if (sources.size < 2) return { published: false, reason: "single_source" };
  for (const a of cluster) {
    for (const b of cluster) {
      if (a.source === b.source) continue;
      if (trustPair(a.trust, b.trust, "official", "trusted"))
        return { published: true, reason: "official_and_trusted" };
      if (artistOverlap(a.artists, b.artists) >= ARTIST_OVERLAP_MIN)
        return { published: true, reason: "sources_agree" };
    }
  }
  return { published: false, reason: "no_agreement" };
}

function trustPair(a: SourceTrust, b: SourceTrust, x: SourceTrust, y: SourceTrust): boolean {
  return (a === x && b === y) || (a === y && b === x);
}

const TRUST_ORDER: Readonly<Record<SourceTrust, number>> = {
  official: 1,
  structured: 2,
  trusted: 3,
};
/** D-055: the organiser's own site beats Wikipedia on city, venue and dates. */
const ORGANISERS: ReadonlySet<string> = new Set(["sunburn", "teaminnovation"]);
const authority = (c: ValidatedCandidate) => (ORGANISERS.has(c.source) ? 0 : TRUST_ORDER[c.trust]);

/** Organiser first, then other official, structured, trusted; then the most confident. */
export function byAuthority(a: ValidatedCandidate, b: ValidatedCandidate): number {
  return authority(a) - authority(b) || b.confidence - a.confidence;
}

export type MergedEvent = {
  title: string;
  type: EventType;
  startsAt: Date;
  endsAt: Date | null;
  city: string;
  country: string;
  venueName: string | null;
  /** Union of confirmed main acts, the most authoritative source's order first. */
  artists: string[];
  /** Union of confirmed support acts not also billed as main acts. */
  supportActs: string[];
  sources: { source: CollectorSource; externalId: string; url: string }[];
};

/** One event's facts from a cluster: title and dates from the most authoritative member. */
export function mergeCluster(cluster: readonly ValidatedCandidate[]): MergedEvent {
  const ordered = [...cluster].sort(byAuthority);
  const lead = ordered[0]!;
  const artists: string[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    for (const name of c.artists) {
      const key = normalizeArtistName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      artists.push(name);
    }
  }
  const supportActs = [
    ...new Map(
      ordered.flatMap((c) => c.supportActs).map((n) => [normalizeArtistName(n), n] as const),
    ),
  ]
    .filter(([key]) => !seen.has(key))
    .map(([, name]) => name);
  return {
    title: lead.title,
    type: ordered.some((c) => c.type === "festival") ? "festival" : lead.type,
    startsAt: lead.startsAt,
    endsAt: lead.endsAt ?? ordered.find((c) => c.endsAt !== null)?.endsAt ?? null,
    city: lead.city,
    country: lead.country,
    venueName: ordered.find((c) => c.venueName !== null)?.venueName ?? null,
    artists,
    supportActs,
    sources: ordered.map((c) => ({ source: c.source, externalId: c.externalId, url: c.url })),
  };
}

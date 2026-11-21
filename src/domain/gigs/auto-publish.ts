/**
 * The strict auto-publish gate (D-074, amends D-056: publishing is gate-or-Lead). Pure.
 * One night of one show is published automatically only when **all** of these hold:
 *  1. ≥ 2 independent sources (different registrable domains), ≥ 1 of them official
 *     (the artist's site, the organiser, the venue or a primary ticketing page);
 *  2. on one official source: title, date, start time (or explicit date-only), city and
 *     headliner are each grounded by an exact quote that states the value;
 *  3. no source conflicts with another on date, time, city or headliner (a conflict holds;
 *     the majority never wins);
 *  4. the night is in the future, ≤ 18 months away, and the official quote writes the year
 *     out (the 2025-vs-2027 failure, D-054);
 *  5. the headliner's Spotify match is confident (`auto`, or `manual` = confirmed by the Lead);
 *  6. the lineup isn't identical to an archived edition of the same series (the old-Sunburn
 *     lineup failure, D-055);
 *  7. confidence ≥ 0.9;
 *  8. no source says it's cancelled or postponed.
 * A failed 4 (past or too far) or 6 rejects; anything else failing holds it for review.
 *
 * D-089 adds two more paths with the same shared rules (3–6 and 8 above, plus no conflicts):
 *  - **first_party**: the artist's or organiser's OWN site (Wikidata P856 or our organiser
 *    allow-list) quotes the date with its year, the city and the headliner. Confidence 0.85.
 *  - **press**: ≥ 3 independent articles on readable D-087 outlets (different publishers; one
 *    wire story or press release counts once), each published ≤ 90 days ago, each quoting the
 *    date with its year, the city and the headliner, agreeing with each other (venue too, when
 *    stated). Confidence 0.8, status "press".
 * The standard path is tried first, then first_party, then press.
 */
import { findCity } from "../events/extract/places";
import { checkPublishVisual, NO_IMAGE_MESSAGE, type EventVisual } from "../events/publish-visual";
import { foldText } from "../events/text";
import { normalizeCity } from "../events/venue";
import type { MatchStatus } from "../shared/lineup";
import { normalizeArtistName } from "../shared/normalize";
import { isoDate, parseJsonLdStart } from "./extract";
import { independentArticles, pressOutlet } from "./press";
import type { GigProvenance, OfficialKind } from "./provenance";
import { findDateMentions, findShowTime } from "./show-dates";

export const AUTO_PUBLISH_MIN_CONFIDENCE = 0.9;
export const MAX_MONTHS_AHEAD = 18;
const DAY_MS = 86_400_000;

export type GateSource = {
  url: string;
  /** Registrable domain (eTLD+1). */
  domain: string;
  officialKind: OfficialKind | null;
  title: string;
  /** The night as an IST calendar date, "YYYY-MM-DD". */
  night: string;
  startTime: string | null;
  dateOnly: boolean;
  /** The source gave a range, not listed nights: it can't speak for one night. */
  dateRange: boolean;
  city: string;
  /** Confirmed main acts, headliner first. */
  artists: readonly string[];
  quotes: GigProvenance["quotes"];
  cancelled: boolean;
  /** D-089: the artist's or organiser's own site (P856 / organiser allow-list). */
  firstParty?: boolean;
  /** D-089: the venue as the source states it, when it does. */
  venue?: string | null;
  /** D-089: news-article facts, when the source is a press article. */
  press?: GigProvenance["press"];
};

export type GateInput = {
  now: Date;
  sources: readonly GateSource[];
  headlinerMatch: MatchStatus | null;
  /** Archived editions of the same series (lineups of normalized-or-display names). */
  archivedLineups: ReadonlyArray<readonly string[]>;
  confidence: number;
  /** D-089 paths, off unless enabled (`AUTO_PUBLISH_EXTRA_PATHS`): evaluated and reported only. */
  extraPaths?: { firstParty?: boolean; press?: boolean };
  /**
   * D-091: the stored event's poster and headliner photos. When given, a night without a
   * picture is held (reason `no_image`). Omitted when re-checking a published night: a
   * missing picture never unpublishes.
   */
  visual?: EventVisual | null;
};

export type GateRule =
  | "independent_sources"
  | "official_grounded"
  | "no_conflicts"
  | "date_window"
  | "headliner_matched"
  | "not_a_rerun"
  | "confidence"
  | "not_cancelled"
  | "first_party_grounded"
  | "press_confirmed"
  | "has_image";

export type GateCheck = { rule: GateRule; ok: boolean; detail: string };
export type GateVerdict = "publish" | "hold" | "reject";
export const PUBLISH_PATHS = ["standard", "first_party", "press"] as const;
export type PublishPath = (typeof PUBLISH_PATHS)[number];
/** D-089: the confidence each path publishes with (standard: the D-056 score itself). */
export const PATH_CONFIDENCE = { first_party: 0.85, press: 0.8 } as const;
export const PRESS_MIN_ARTICLES = 3;
export const PRESS_MAX_AGE_DAYS = 90;

export type GateDecision = {
  decision: GateVerdict;
  reasons: string[];
  /** Shared rules plus the standard path's rules (the D-074 checks). */
  checks: GateCheck[];
  /** D-089: the path that published, or null. */
  path: PublishPath | null;
  /** The confidence to store when published (null when not published). */
  confidence: number | null;
  /** D-089: each alternative path's own check. */
  alternatives: Record<Exclude<PublishPath, "standard">, GateCheck>;
};

const REJECTING: ReadonlySet<GateRule> = new Set(["date_window", "not_a_rerun"]);

const istNight = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const headlinerOf = (s: GateSource) => s.artists[0] ?? null;

/** True when the quote states this night with a written-out year (text or ISO). */
export function quoteStatesNight(quote: string | undefined, night: string): boolean {
  if (!quote) return false;
  const iso = parseJsonLdStart(quote.trim());
  if (iso) return isoDate(iso.night) === night;
  return findDateMentions(quote).some((m) =>
    m.kind === "nights" ? m.nights.some((n) => isoDate(n) === night) : false,
  );
}

function quoteStatesTime(quote: string | undefined, hhmm: string): boolean {
  if (!quote) return false;
  const iso = parseJsonLdStart(quote.trim());
  if (iso) return iso.time === hhmm;
  return findShowTime(quote)?.hhmm === hhmm;
}

const quoteNames = (quote: string | undefined, value: string) =>
  quote !== undefined && value.trim() !== "" && foldText(quote).includes(foldText(value));

/** Which grounding requirements a source fails (empty = fully grounded). */
export function groundingGaps(s: GateSource): string[] {
  const gaps: string[] = [];
  const headliner = headlinerOf(s);
  const q = s.quotes;
  const titleOk =
    quoteNames(q.title, s.title) ||
    // A title we composed ("<Headliner> Live in <City>") is grounded by its two parts.
    (q.title === undefined &&
      headliner !== null &&
      foldText(s.title) === foldText(`${headliner} Live in ${s.city}`) &&
      quoteNames(q.headliner, headliner) &&
      findCity(q.city ?? "") === s.city);
  if (!titleOk) gaps.push("title");
  if (!quoteStatesNight(q.date, s.night)) gaps.push("date");
  if (s.startTime ? !quoteStatesTime(q.time, s.startTime) : !s.dateOnly) gaps.push("time");
  if (findCity(q.city ?? "") !== s.city) gaps.push("city");
  if (!headliner || !quoteNames(q.headliner, headliner)) gaps.push("headliner");
  return gaps;
}

function conflicts(sources: readonly GateSource[]): string[] {
  const out: string[] = [];
  const distinct = (values: Array<string | null>) => [
    ...new Set(values.filter((v): v is string => v !== null)),
  ];
  const nights = distinct(sources.map((s) => s.night));
  if (nights.length > 1) out.push(`date: ${nights.join(" ≠ ")}`);
  const cities = distinct(sources.map((s) => normalizeCity(s.city)));
  if (cities.length > 1) out.push(`city: ${cities.join(" ≠ ")}`);
  const times = distinct(sources.map((s) => s.startTime));
  if (times.length > 1) out.push(`time: ${times.join(" ≠ ")}`);
  const heads = sources.map(headlinerOf).filter((h): h is string => h !== null);
  const lead = heads[0];
  if (lead) {
    const key = normalizeArtistName(lead);
    const missing = sources.filter(
      (s) => s.artists.length > 0 && !s.artists.some((a) => normalizeArtistName(a) === key),
    );
    if (missing.length > 0) {
      out.push(`headliner: ${lead} not named by ${missing.map((s) => s.domain).join(", ")}`);
    }
  }
  return out;
}

function dateWindow(input: GateInput, official: GateSource | undefined): GateCheck {
  const nightIso = official?.night ?? input.sources[0]?.night;
  if (!nightIso) return { rule: "date_window", ok: false, detail: "no date" };
  const night = istNight(nightIso);
  const horizon = new Date(input.now);
  horizon.setUTCMonth(horizon.getUTCMonth() + MAX_MONTHS_AHEAD);
  if (night.getTime() < input.now.getTime() - DAY_MS) {
    return { rule: "date_window", ok: false, detail: `${nightIso} is in the past` };
  }
  if (night.getTime() > horizon.getTime()) {
    return { rule: "date_window", ok: false, detail: `${nightIso} is more than 18 months away` };
  }
  return { rule: "date_window", ok: true, detail: nightIso };
}

const sameLineup = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a.map(normalizeArtistName));
  const y = new Set(b.map(normalizeArtistName));
  return x.size > 0 && x.size === y.size && [...x].every((n) => y.has(n));
};

/** Whether a first-party source grounds date (with year), city and headliner (D-089). */
export function firstPartyGaps(s: GateSource): string[] {
  return groundingGaps(s).filter((g) => g !== "title" && g !== "time");
}

function firstPartyCheck(usable: readonly GateSource[]): {
  check: GateCheck;
  source: GateSource | undefined;
} {
  const own = usable.filter((s) => s.firstParty === true);
  const source = own.find((s) => firstPartyGaps(s).length === 0);
  return {
    source,
    check: {
      rule: "first_party_grounded",
      ok: source !== undefined,
      detail: source
        ? `grounded on the own site ${source.domain}`
        : own.length === 0
          ? "no artist or organiser own site"
          : own
              .map((s) => `${s.domain} lacks quotes for ${firstPartyGaps(s).join(", ")}`)
              .join("; "),
    },
  };
}

/** Why a press source doesn't count (empty = it counts). */
export function pressGaps(s: GateSource, now: Date): string[] {
  const gaps: string[] = [];
  const outlet = pressOutlet(s.url);
  if (!outlet?.readable) gaps.push("not a readable D-087 outlet");
  const published = s.press?.publishedAt ? Date.parse(s.press.publishedAt) : NaN;
  if (Number.isNaN(published)) gaps.push("no publication date");
  else if (published > now.getTime() + DAY_MS) gaps.push("publication date in the future");
  else if (now.getTime() - published > PRESS_MAX_AGE_DAYS * DAY_MS) {
    gaps.push(`published more than ${PRESS_MAX_AGE_DAYS} days ago`);
  }
  gaps.push(...firstPartyGaps(s));
  return gaps;
}

function venueConflict(sources: readonly GateSource[]): string | null {
  const venues = [
    ...new Set(
      sources.flatMap((s) =>
        s.venue
          ? [
              foldText(s.venue)
                .replace(/\bthe\b/gu, "")
                .trim(),
            ]
          : [],
      ),
    ),
  ];
  return venues.length > 1 ? `venue: ${venues.join(" ≠ ")}` : null;
}

function pressCheck(usable: readonly GateSource[], now: Date): GateCheck {
  const articles = usable.filter((s) => s.press);
  const counted = articles.filter((s) => pressGaps(s, now).length === 0);
  const groups = independentArticles(
    counted.map((s) => ({
      url: s.url,
      domain: s.domain,
      wire: s.press!.wire,
      fingerprint: s.press!.fingerprint,
    })),
  );
  const venue = venueConflict(articles);
  const ok = groups.length >= PRESS_MIN_ARTICLES && venue === null;
  const skipped = articles
    .filter((s) => !counted.includes(s))
    .map((s) => `${s.domain}: ${pressGaps(s, now).join(", ")}`);
  return {
    rule: "press_confirmed",
    ok,
    detail:
      `${groups.length} independent article(s) of ${articles.length} (needs ${PRESS_MIN_ARTICLES})` +
      (venue ? `; ${venue}` : "") +
      (skipped.length > 0 ? `; not counted: ${skipped.join("; ")}` : ""),
  };
}

/** The gate's verdict for one night, with every rule's result. */
/**
 * D-091: the image rule as a gate check. A night that would publish without a poster or a
 * headliner photo is held with reason `no_image` (never rejected: a picture can still come).
 */
export function applyImageRule(gate: GateDecision, visual: EventVisual | null): GateDecision {
  const visualCheck = checkPublishVisual(visual);
  const check: GateCheck = {
    rule: "has_image",
    ok: visualCheck.ok,
    detail: visualCheck.ok ? `picture: ${visualCheck.via}` : `no_image: ${NO_IMAGE_MESSAGE}`,
  };
  const checks = [...gate.checks.filter((c) => c.rule !== "has_image"), check];
  if (check.ok || gate.decision !== "publish") return { ...gate, checks };
  return {
    ...gate,
    decision: "hold",
    reasons: [`has_image: ${check.detail}`],
    checks,
    path: null,
    confidence: null,
  };
}

export function autoPublishDecision(input: GateInput): GateDecision {
  const gate = decideWithoutImage(input);
  return input.visual === undefined ? gate : applyImageRule(gate, input.visual);
}

function decideWithoutImage(input: GateInput): GateDecision {
  const usable = input.sources.filter((s) => !s.dateRange);
  const domains = new Set(usable.map((s) => s.domain));
  const officials = usable.filter((s) => s.officialKind !== null);
  const grounded = officials.find((s) => groundingGaps(s).length === 0);
  const firstParty = firstPartyCheck(usable);
  const press = pressCheck(usable, input.now);
  const shared: GateCheck[] = [];
  const standard: GateCheck[] = [];
  const add = (to: GateCheck[], rule: GateRule, ok: boolean, detail: string) =>
    to.push({ rule, ok, detail });

  add(
    standard,
    "independent_sources",
    domains.size >= 2 && officials.length >= 1,
    `${domains.size} independent domain(s) [${[...domains].join(", ")}], ${officials.length} official`,
  );
  add(
    standard,
    "official_grounded",
    grounded !== undefined,
    grounded
      ? `grounded on ${grounded.domain}`
      : officials.length === 0
        ? "no official source"
        : officials
            .map((s) => `${s.domain} lacks quotes for ${groundingGaps(s).join(", ")}`)
            .join("; "),
  );
  const conflict = conflicts(input.sources);
  add(shared, "no_conflicts", conflict.length === 0, conflict.join("; ") || "sources agree");
  // The date that matters is the one the deciding source states.
  const window = dateWindow(input, grounded ?? firstParty.source ?? officials[0]);
  add(shared, window.rule, window.ok, window.detail);
  add(
    shared,
    "headliner_matched",
    input.headlinerMatch === "auto" || input.headlinerMatch === "manual",
    `Spotify match: ${input.headlinerMatch ?? "none"}`,
  );
  const lineup = (grounded ?? firstParty.source ?? usable[0])?.artists ?? [];
  const rerun = input.archivedLineups.some((past) => sameLineup(lineup, past));
  add(
    shared,
    "not_a_rerun",
    !rerun,
    rerun ? "lineup identical to an archived edition" : "new lineup",
  );
  add(
    standard,
    "confidence",
    input.confidence >= AUTO_PUBLISH_MIN_CONFIDENCE,
    `${input.confidence} (needs ${AUTO_PUBLISH_MIN_CONFIDENCE})`,
  );
  const cancelled = input.sources.filter((s) => s.cancelled);
  add(
    shared,
    "not_cancelled",
    cancelled.length === 0,
    cancelled.length === 0
      ? "no cancellation"
      : `cancelled per ${cancelled.map((s) => s.domain).join(", ")}`,
  );

  // Keep the D-074 check order: sources, grounding, conflicts, window, match, re-run, confidence, cancel.
  const order: GateRule[] = [
    "independent_sources",
    "official_grounded",
    "no_conflicts",
    "date_window",
    "headliner_matched",
    "not_a_rerun",
    "confidence",
    "not_cancelled",
  ];
  const checks = [...shared, ...standard].sort(
    (a, b) => order.indexOf(a.rule) - order.indexOf(b.rule),
  );
  const alternatives = { first_party: firstParty.check, press };
  const sharedFailed = shared.filter((c) => !c.ok);
  const path: PublishPath | null =
    sharedFailed.length > 0
      ? null
      : standard.every((c) => c.ok)
        ? "standard"
        : firstParty.check.ok && input.extraPaths?.firstParty === true
          ? "first_party"
          : press.ok && input.extraPaths?.press === true
            ? "press"
            : null;
  if (path !== null) {
    return {
      decision: "publish",
      reasons: [],
      checks,
      path,
      confidence: path === "standard" ? input.confidence : PATH_CONFIDENCE[path],
      alternatives,
    };
  }
  const failed = checks.filter((c) => !c.ok);
  const decision: GateVerdict = failed.some((c) => REJECTING.has(c.rule)) ? "reject" : "hold";
  return {
    decision,
    reasons: [
      ...failed.map((c) => `${c.rule}: ${c.detail}`),
      ...(sharedFailed.length === 0
        ? [`first_party: ${firstParty.check.detail}`, `press: ${press.detail}`]
        : []),
    ],
    checks,
    path: null,
    confidence: null,
    alternatives,
  };
}

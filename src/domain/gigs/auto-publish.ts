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
 */
import { findCity } from "../events/extract/places";
import { foldText } from "../events/text";
import { normalizeCity } from "../events/venue";
import type { MatchStatus } from "../shared/lineup";
import { normalizeArtistName } from "../shared/normalize";
import { isoDate, parseJsonLdStart } from "./extract";
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
};

export type GateInput = {
  now: Date;
  sources: readonly GateSource[];
  headlinerMatch: MatchStatus | null;
  /** Archived editions of the same series (lineups of normalized-or-display names). */
  archivedLineups: ReadonlyArray<readonly string[]>;
  confidence: number;
};

export type GateRule =
  | "independent_sources"
  | "official_grounded"
  | "no_conflicts"
  | "date_window"
  | "headliner_matched"
  | "not_a_rerun"
  | "confidence"
  | "not_cancelled";

export type GateCheck = { rule: GateRule; ok: boolean; detail: string };
export type GateVerdict = "publish" | "hold" | "reject";
export type GateDecision = { decision: GateVerdict; reasons: string[]; checks: GateCheck[] };

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

/** The gate's verdict for one night, with every rule's result. */
export function autoPublishDecision(input: GateInput): GateDecision {
  const usable = input.sources.filter((s) => !s.dateRange);
  const domains = new Set(usable.map((s) => s.domain));
  const officials = usable.filter((s) => s.officialKind !== null);
  const grounded = officials.find((s) => groundingGaps(s).length === 0);
  const checks: GateCheck[] = [];
  const add = (rule: GateRule, ok: boolean, detail: string) => checks.push({ rule, ok, detail });

  add(
    "independent_sources",
    domains.size >= 2 && officials.length >= 1,
    `${domains.size} independent domain(s) [${[...domains].join(", ")}], ${officials.length} official`,
  );
  add(
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
  add("no_conflicts", conflict.length === 0, conflict.join("; ") || "sources agree");
  const window = dateWindow(input, grounded ?? officials[0]);
  add(window.rule, window.ok, window.detail);
  add(
    "headliner_matched",
    input.headlinerMatch === "auto" || input.headlinerMatch === "manual",
    `Spotify match: ${input.headlinerMatch ?? "none"}`,
  );
  const lineup = (grounded ?? usable[0])?.artists ?? [];
  const rerun = input.archivedLineups.some((past) => sameLineup(lineup, past));
  add("not_a_rerun", !rerun, rerun ? "lineup identical to an archived edition" : "new lineup");
  add(
    "confidence",
    input.confidence >= AUTO_PUBLISH_MIN_CONFIDENCE,
    `${input.confidence} (needs ${AUTO_PUBLISH_MIN_CONFIDENCE})`,
  );
  const cancelled = input.sources.filter((s) => s.cancelled);
  add(
    "not_cancelled",
    cancelled.length === 0,
    cancelled.length === 0
      ? "no cancellation"
      : `cancelled per ${cancelled.map((s) => s.domain).join(", ")}`,
  );

  const failed = checks.filter((c) => !c.ok);
  const decision: GateVerdict = failed.some((c) => REJECTING.has(c.rule))
    ? "reject"
    : failed.length > 0
      ? "hold"
      : "publish";
  return { decision, reasons: failed.map((c) => `${c.rule}: ${c.detail}`), checks };
}

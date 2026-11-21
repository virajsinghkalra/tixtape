/**
 * Layered verification of one event (D-054, D-055, D-056 layers 1–4). Pure: the collector
 * gathers the evidence (sources, identities, geocode, past lineups) and this decides.
 *
 * - Layer 1, extraction: the date's year is explicit; the date is in the future and ≤ 18 months
 *   away; the city is a known Indian city.
 * - Layer 2, agreement field by field (date, city, venue, headliners): a field is verified by
 *   ≥ 2 independent sources (syndicated copies share a fingerprint and count once) or stated by
 *   an official organiser source. Any disagreement on date or city is a conflict.
 * - Layer 3, entities: every artist is Spotify-confirmed (upstream); headliners found on
 *   Wikidata/MusicBrainz must be active; a geocoded venue must lie in the stated city.
 * - Layer 4, sanity: not a stale copy of a past edition's lineup; no city conflict for the
 *   series; plausible size and duration; one article can't create a burst of events.
 * The result is stored as `events.verification` and drives `confidence`.
 */
import {
  LINEUP_INCOMPLETE,
  lineupCompleteness,
  type LineupCompleteness,
} from "../lineup-completeness";
import { istDay } from "../ist-calendar";
import { jaccard } from "../similarity";
import { foldText } from "../text";
import { knownCity, normalizeCity, normalizeVenueName } from "../venue";
import { normalizeArtistName } from "@/domain/shared/normalize";
import type { CollectorSource, SourceTrust, ValidatedCandidate } from "./candidate";

/** The organiser's or festival's own site: "official" in D-056's sense. */
export const ORGANISER_SOURCES: ReadonlySet<CollectorSource> = new Set([
  "sunburn",
  "teaminnovation",
  // D-073: the artist's own site is official. HighApe is not: anyone can list there and its
  // acts come from free-text titles, so a single listing must never pass on its own.
  "artist_site",
]);

export const MAX_MONTHS_AHEAD = 18;
export const STALE_LINEUP_SIMILARITY = 0.8;
export const MAX_EVENTS_PER_ARTICLE = 10;
const MAX_ARTISTS = 150;
const MAX_CONCERT_ARTISTS = 15;
const MAX_DAYS = 10;
const ACTIVE_YEARS = 5;
const DAY_MS = 86_400_000;

export type SourceEvidence = {
  source: CollectorSource;
  url: string;
  trust: SourceTrust;
  official: boolean;
};

/** "press": set only by the D-089 press path when it publishes (never by `verifyEvent`). */
export type FieldStatus = "verified" | "official" | "single" | "conflict" | "missing" | "press";

export type FieldVerification = {
  value: string | null;
  status: FieldStatus;
  agreeing: SourceEvidence[];
  /** Independent origins among `agreeing`. */
  independent: number;
  disagreeing: Array<SourceEvidence & { value: string }>;
};

export type ArtistVerification = {
  name: string;
  /** Confirmed by an organiser source or ≥ 2 independent sources. */
  confirmed: boolean;
  sources: number;
  official: boolean;
  identity: "active" | "inactive" | "unknown";
};

export type Check = {
  layer: 1 | 2 | 3 | 4;
  name: string;
  /** null: couldn't be checked (no data); it neither passes nor fails the event. */
  ok: boolean | null;
  detail: string;
};

export type Verification = {
  checkedAt: string;
  fields: {
    date: FieldVerification;
    city: FieldVerification;
    venue: FieldVerification;
    headliners: FieldVerification & { artists: ArtistVerification[] };
  };
  checks: Check[];
  flags: string[];
  /** Independent origins across all sources. */
  independentSources: number;
  confidence: number;
  /** Layers 1–4 pass: the event may be offered to the Lead for publishing. */
  passes: boolean;
  /** D-091: stored vs announced acts. Absent on verifications written before D-091. */
  lineupCompleteness?: LineupCompleteness;
};

export type HeadlinerIdentity = {
  wikidataId: string | null;
  mbid: string | null;
  /** Year of the most recent release, when known. */
  lastReleaseYear: number | null;
};

export type VerifyContext = {
  now: Date;
  /** Lineups of past editions of the same series (stored events, Wikipedia history). */
  pastLineups?: ReadonlyArray<readonly string[]>;
  /** By normalized artist name. Missing entries mean "not looked up". */
  identities?: ReadonlyMap<string, HeadlinerIdentity | null>;
  /** The venue's geocoded city; undefined when not checked, null when not found. */
  venueGeoCity?: string | null;
  /** Cities other sources give for the same series around the same dates. */
  conflictingCities?: readonly string[];
  /** Events the lead article produced in this run. */
  eventsFromSameArticle?: number;
};

const evidence = (c: ValidatedCandidate): SourceEvidence => ({
  source: c.source,
  url: c.url,
  trust: c.trust,
  official: ORGANISER_SOURCES.has(c.source),
});

type Origin = (c: ValidatedCandidate) => string;

/** Who published an item: our adapter's source, or the site for generic web pages. */
function publisher(c: ValidatedCandidate): string {
  if (c.source !== "web") return c.source;
  try {
    return new URL(c.url).hostname.replace(/^www\./u, "");
  } catch {
    return c.url;
  }
}

/**
 * Independence (D-056): items from the same publisher are one source, and copies of one press
 * release (same fingerprint) are one source even across publishers. Returns each member's
 * group key.
 */
export function independenceOf(members: readonly ValidatedCandidate[]): Origin {
  const parent = new Map<ValidatedCandidate, ValidatedCandidate>();
  const find = (c: ValidatedCandidate): ValidatedCandidate => {
    const p = parent.get(c) ?? c;
    if (p === c) return c;
    const root = find(p);
    parent.set(c, root);
    return root;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      const sameText = (a.fingerprint ?? a.url) === (b.fingerprint ?? b.url);
      if (publisher(a) === publisher(b) || sameText) parent.set(find(b), find(a));
    }
  }
  return (c) => {
    const root = find(c);
    return `${root.source}:${root.externalId}`;
  };
}

function istDate(d: Date): string {
  const day = istDay(d);
  return `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

const dateValue = (c: ValidatedCandidate) =>
  c.endsAt ? `${istDate(c.startsAt)}/${istDate(c.endsAt)}` : istDate(c.startsAt);

/** Official first, then the most-supported value. */
function field(
  members: readonly ValidatedCandidate[],
  origin: Origin,
  valueOf: (c: ValidatedCandidate) => string | null,
  keyOf: (v: string) => string = (v) => v,
): FieldVerification {
  const byKey = new Map<string, { value: string; members: ValidatedCandidate[] }>();
  for (const m of members) {
    const v = valueOf(m);
    if (v === null) continue;
    const k = keyOf(v);
    const entry = byKey.get(k) ?? { value: v, members: [] };
    entry.members.push(m);
    byKey.set(k, entry);
  }
  if (byKey.size === 0) {
    return { value: null, status: "missing", agreeing: [], independent: 0, disagreeing: [] };
  }
  const ranked = [...byKey.values()].sort((a, b) => {
    const offA = a.members.some((m) => ORGANISER_SOURCES.has(m.source)) ? 1 : 0;
    const offB = b.members.some((m) => ORGANISER_SOURCES.has(m.source)) ? 1 : 0;
    return offB - offA || new Set(b.members.map(origin)).size - new Set(a.members.map(origin)).size;
  });
  const [best, ...others] = ranked;
  const independent = new Set(best!.members.map(origin)).size;
  const official = best!.members.some((m) => ORGANISER_SOURCES.has(m.source));
  const disagreeing = others.flatMap((o) =>
    o.members.map((m) => ({ ...evidence(m), value: o.value })),
  );
  const status: FieldStatus =
    disagreeing.length > 0
      ? "conflict"
      : independent >= 2
        ? "verified"
        : official
          ? "official"
          : "single";
  return {
    value: best!.value,
    status,
    agreeing: best!.members.map(evidence),
    independent,
    disagreeing,
  };
}

const good = (s: FieldStatus) => s === "verified" || s === "official";

function artistChecks(
  members: readonly ValidatedCandidate[],
  ctx: VerifyContext,
  year: number,
  origin: Origin,
): ArtistVerification[] {
  const order: string[] = [];
  const support = new Map<string, { name: string; origins: Set<string>; official: boolean }>();
  for (const m of members) {
    for (const name of m.artists) {
      const key = normalizeArtistName(name);
      if (!support.has(key)) {
        order.push(key);
        support.set(key, { name, origins: new Set(), official: false });
      }
      const s = support.get(key)!;
      s.origins.add(origin(m));
      if (ORGANISER_SOURCES.has(m.source)) s.official = true;
    }
  }
  return order.map((key) => {
    const s = support.get(key)!;
    const id = ctx.identities?.get(key);
    const identity: ArtistVerification["identity"] =
      !id || id.lastReleaseYear === null
        ? "unknown"
        : id.lastReleaseYear >= year - ACTIVE_YEARS
          ? "active"
          : "inactive";
    return {
      name: s.name,
      confirmed: s.official || s.origins.size >= 2,
      sources: s.origins.size,
      official: s.official,
      identity,
    };
  });
}

/** Verifies one cluster of candidates describing the same event. */
export function verifyEvent(
  members: readonly ValidatedCandidate[],
  ctx: VerifyContext,
): Verification {
  const now = ctx.now;
  const year = istDay(now).year;
  const origin = independenceOf(members);
  const explicit = members.filter((m) => m.dateExplicit);
  const date = field(explicit, origin, dateValue);
  const city = field(members, origin, (m) => m.city, normalizeCity);
  if ((ctx.conflictingCities ?? []).length > 0 && city.status !== "missing") {
    city.status = "conflict";
    for (const other of ctx.conflictingCities ?? []) {
      city.disagreeing.push({
        source: "wikipedia",
        url: "",
        trust: "official",
        official: false,
        value: other,
      });
    }
  }
  const venueCity = city.value ?? "";
  const venue = field(
    members,
    origin,
    (m) => m.venueName,
    (v) => normalizeVenueName(v, venueCity),
  );
  const artists = artistChecks(members, ctx, year, origin);
  const confirmedArtists = artists.filter((a) => a.confirmed);
  const headliners: Verification["fields"]["headliners"] = {
    value: confirmedArtists.length > 0 ? confirmedArtists.map((a) => a.name).join(", ") : null,
    status:
      artists.length === 0
        ? "missing"
        : confirmedArtists.length > 0 && artists[0]!.confirmed
          ? confirmedArtists.every((a) => a.sources >= 2)
            ? "verified"
            : "official"
          : "single",
    agreeing: members.filter((m) => m.artists.length > 0).map(evidence),
    independent: new Set(members.filter((m) => m.artists.length > 0).map(origin)).size,
    disagreeing: [],
    artists,
  };

  const lead = [...explicit].sort(
    (a, b) => Number(ORGANISER_SOURCES.has(b.source)) - Number(ORGANISER_SOURCES.has(a.source)),
  )[0];
  const start = lead?.startsAt ?? members[0]!.startsAt;
  const end = lead?.endsAt ?? null;
  const todayStart = now.getTime() - DAY_MS;
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + MAX_MONTHS_AHEAD);
  const checks: Check[] = [];
  const check = (layer: Check["layer"], name: string, ok: boolean | null, detail: string) =>
    checks.push({ layer, name, ok, detail });

  // Layer 1
  check(
    1,
    "date_explicit",
    explicit.length > 0,
    explicit.length > 0 ? "year stated by the source" : "no source states the year",
  );
  check(1, "date_future", (end ?? start).getTime() >= todayStart, istDate(start));
  check(1, "date_within_18_months", start.getTime() <= horizon.getTime(), istDate(start));
  check(
    1,
    "city_known",
    city.value !== null && knownCity(foldText(city.value)) !== null,
    city.value ?? "none",
  );
  // Layer 2
  check(2, "date_agreement", good(date.status), date.status);
  check(2, "city_agreement", good(city.status), city.status);
  check(
    2,
    "venue_agreement",
    venue.status === "conflict" ? false : good(venue.status) ? true : null,
    venue.status,
  );
  const independent = new Set(members.map(origin)).size;
  const lineupOk = headliners.status === "missing" ? independent >= 2 : good(headliners.status);
  check(
    2,
    "headliners",
    lineupOk,
    headliners.status === "missing"
      ? independent >= 2
        ? "lineup not announced; event confirmed by 2+ sources"
        : "no lineup and only one source"
      : `${confirmedArtists.length}/${artists.length} artists confirmed`,
  );
  // Layer 3
  const checkedIds = artists.slice(0, 3).filter((a) => a.identity !== "unknown");
  check(
    3,
    "headliners_active",
    checkedIds.length === 0 ? null : checkedIds.every((a) => a.identity === "active"),
    checkedIds.length === 0
      ? "no Wikidata/MusicBrainz identity found"
      : checkedIds.map((a) => `${a.name}: ${a.identity}`).join("; "),
  );
  check(
    3,
    "venue_in_city",
    ctx.venueGeoCity === undefined || ctx.venueGeoCity === null || city.value === null
      ? null
      : normalizeCity(ctx.venueGeoCity) === normalizeCity(city.value),
    ctx.venueGeoCity === undefined
      ? "not geocoded"
      : `geocoded to ${ctx.venueGeoCity ?? "nothing"}`,
  );
  // Layer 4
  const lineupKeys = artists.map((a) => normalizeArtistName(a.name));
  const staleness = Math.max(
    0,
    ...(ctx.pastLineups ?? []).map((past) =>
      lineupKeys.length >= 3 ? jaccard(lineupKeys, past.map(normalizeArtistName)) : 0,
    ),
  );
  check(
    4,
    "not_stale_lineup",
    staleness < STALE_LINEUP_SIMILARITY,
    `max similarity to a past edition ${staleness.toFixed(2)}`,
  );
  check(
    4,
    "series_city",
    (ctx.conflictingCities ?? []).length === 0,
    (ctx.conflictingCities ?? []).join(", ") || "consistent",
  );
  const days = end ? Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1 : 1;
  const maxArtists = members.some((m) => m.type === "festival") ? MAX_ARTISTS : MAX_CONCERT_ARTISTS;
  check(
    4,
    "plausible",
    artists.length <= maxArtists && days <= MAX_DAYS,
    `${artists.length} artists, ${days} day(s)`,
  );
  check(
    4,
    "no_source_burst",
    independent >= 2 || (ctx.eventsFromSameArticle ?? 1) <= MAX_EVENTS_PER_ARTICLE,
    `${ctx.eventsFromSameArticle ?? 1} event(s) from one article this run`,
  );

  const flags = checks.filter((c) => c.ok === false).map((c) => c.name);
  if (isCancelled(members)) flags.push("cancelled");
  if (headliners.status === "missing") flags.push("lineup_not_announced");
  if (venue.status === "missing") flags.push("venue_unknown");
  // D-091: a bill shorter than a source announces, or a festival with headliners only.
  const fullest = [...members].sort(
    (a, b) => b.artists.length + b.supportActs.length - (a.artists.length + a.supportActs.length),
  )[0];
  const completeness = lineupCompleteness({
    type: members.some((m) => m.type === "festival") ? "festival" : "concert",
    stored: artists.length,
    announced: fullest ? fullest.artists.length + fullest.supportActs.length : null,
    source: fullest?.source ?? null,
  });
  if (completeness.status === "incomplete" && headliners.status !== "missing") {
    flags.push(LINEUP_INCOMPLETE);
  }
  const passes = checks.every((c) => c.ok !== false);

  const weight: Record<FieldStatus, number> = {
    verified: 1,
    official: 0.9,
    press: 0.8,
    single: 0.4,
    missing: 0.15,
    conflict: 0,
  };
  let confidence =
    0.25 * weight[date.status] +
    0.2 * weight[city.status] +
    0.15 * weight[venue.status] +
    0.25 * weight[headliners.status] +
    0.15 * (checkedIds.length > 0 && checkedIds.every((a) => a.identity === "active") ? 1 : 0.5);
  // Informational flags describe our data, not whether the event is real: no penalty.
  const informational = new Set<string>([
    "lineup_not_announced",
    "venue_unknown",
    LINEUP_INCOMPLETE,
  ]);
  confidence -= 0.15 * flags.filter((f) => !informational.has(f)).length;
  confidence = Math.max(0, Math.min(1, passes ? confidence : Math.min(confidence, 0.5)));

  return {
    checkedAt: now.toISOString(),
    fields: { date, city, venue, headliners },
    checks,
    flags,
    independentSources: independent,
    confidence: Math.round(confidence * 100) / 100,
    passes,
    lineupCompleteness: completeness,
  };
}

// ── D-060: re-verification cadence ─────────────────────────────────────────

const HOUR_MS = 3_600_000;

/** How often a stored event is re-verified, by how soon it starts (proposal D-060). */
export function reverifyEveryMs(startsAt: Date, now: Date): number {
  const daysOut = (startsAt.getTime() - now.getTime()) / DAY_MS;
  if (daysOut > 60) return 24 * HOUR_MS;
  if (daysOut >= 7) return 6 * HOUR_MS;
  return 3 * HOUR_MS;
}

/** True when the event was never verified or its interval has passed. */
export function reverificationDue(startsAt: Date, lastVerifiedAt: Date | null, now: Date): boolean {
  // A little slack so a 3-hourly schedule that runs a few minutes early still counts.
  const slack = 10 * 60_000;
  return (
    lastVerifiedAt === null ||
    now.getTime() - lastVerifiedAt.getTime() + slack >= reverifyEveryMs(startsAt, now)
  );
}

/** Cancelled when the organiser says so, or two independent sources do. */
export function isCancelled(members: readonly ValidatedCandidate[]): boolean {
  const saying = members.filter((m) => m.cancelled);
  return (
    saying.some((m) => ORGANISER_SOURCES.has(m.source)) ||
    new Set(saying.map((m) => m.fingerprint ?? m.url)).size >= 2
  );
}

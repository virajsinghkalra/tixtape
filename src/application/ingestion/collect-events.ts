/**
 * The automatic event collector (P1.11; D-024, D-033, D-050, D-053–D-056). One run:
 *   1. collect candidates from every source (a failing source is reported, the run goes on);
 *   2. keep only artists Spotify confirms (a Spotify block stops the run before any write);
 *   3. remember candidates in `event_candidates`, so corroboration spans runs;
 *   4. cluster this run's candidates with the remembered ones and verify each event in layers
 *      (D-056 1–4: explicit future date, field-by-field agreement of independent sources,
 *      entity checks, sanity checks), with per-field provenance and a confidence score;
 *   5. by mode:
 *      - `dry-run`: write nothing; report what would be held and what would pass;
 *      - `candidates` (default, D-055): write candidates only;
 *      - `hold`: also write events as `held` (never `published`) with their verification,
 *        re-verify published events (layer 6: back to `held` on a failed check or a missing
 *        official listing) and archive past events.
 * Publishing is a separate, Lead-only step (`publishEvents`).
 */
import type { IngestSummary } from "@/application/events";
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import type { Clock } from "@/application/ports/clock";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import type {
  CollectorSource,
  EventCandidate,
  ValidatedCandidate,
} from "@/domain/events/extract/candidate";
import {
  byAuthority,
  clusterCandidates,
  mergeCluster,
  type MergedEvent,
} from "@/domain/events/extract/corroborate";
import {
  isCancelled,
  ORGANISER_SOURCES,
  reverificationDue,
  verifyEvent,
  type HeadlinerIdentity,
  type Verification,
} from "@/domain/events/extract/verify";
import { dedupeKey, eventNameTokens } from "@/domain/events/dedupe";
import { tierFromAttractionOrder } from "@/domain/events/lineup";
import { RawEventSchema, type RawEvent } from "@/domain/events/raw-event";
import { normalizeCity } from "@/domain/events/venue";
import type { EventId } from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { EVENT_SOURCES, type BillingTier, type EventSource } from "@/domain/shared/lineup";
import type { Logger } from "@/lib/logger";
import type {
  ArtistIdentityLookup,
  CandidateSource,
  CandidateStore,
  EventVerificationStore,
  VenueGeocoder,
} from "./ports";
import { doubtReasons, type DoubtResolver, type DoubtUsage } from "./doubt-resolver";
import type { ArtistValidator } from "./validate-artists";

/** Used when no source names the venue; the city is still known. */
export const UNKNOWN_VENUE = "Venue TBA";
const DAY_MS = 86_400_000;
/** D-060: candidates not seen for 30 days are no longer used, and are deleted. */
const CANDIDATE_MEMORY_MS = 30 * DAY_MS;
/** Two festival events of one series this close together are the same edition. */
const SERIES_WINDOW_MS = 60 * DAY_MS;
/** Identity lookups per event (the first-billed acts). */
const IDENTITY_LOOKUPS = 3;
/** Sources whose listings are complete, so a vanished item means the event changed (layer 6). */
const LISTING_SOURCES: ReadonlySet<CollectorSource> = new Set(["teaminnovation"]);

export type CollectMode = "dry-run" | "candidates" | "hold";

/** The `event_source` value a collector source is stored under, or null if the enum lacks it. */
export type PersistAs = (source: CollectorSource) => EventSource | null;

export const persistWhenEnumAllows: PersistAs = (source) =>
  (EVENT_SOURCES as readonly string[]).includes(source) ? (source as EventSource) : null;

export type CollectorDeps = {
  validator: ArtistValidator;
  store: CandidateStore;
  ingest(adapter: SourceAdapter, opts: SourceFetchOptions): Promise<IngestSummary>;
  /** The stored event for a source item, after ingest. */
  findEventId(source: EventSource, externalId: string): Promise<EventId | null>;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Required for `hold` mode; also supplies past lineups for the stale check. */
  verification?: EventVerificationStore;
  identity?: ArtistIdentityLookup;
  geocoder?: VenueGeocoder;
  persistAs?: PersistAs;
  /** D-062/D-064: consulted only for events in doubt. */
  doubt?: DoubtResolver;
  /** Limits the resolver to events whose title contains one of these (case-insensitive). */
  doubtOnly?: readonly string[];
};

export type SourceReport = { source: CollectorSource; itemsSeen: number; error: string | null };

export type EventReport = {
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  city: string;
  venueName: string | null;
  artists: string[];
  supportActs: string[];
  sources: Array<{ source: CollectorSource; url: string }>;
  verification: Verification;
  /** What this run did with it. */
  outcome: "reported" | "candidate" | "held_new" | "held_updated" | "unpublished" | "not_stored";
  detail: string | null;
  eventId: EventId | null;
};

export type CollectReport = {
  mode: CollectMode;
  sources: SourceReport[];
  /** Events with a candidate seen this run (and, in `hold` mode, re-verified stored ones). */
  events: EventReport[];
  ingest: IngestSummary[];
  untitled: number;
  spotifySearches: number;
  archived: number;
  /** Stored events not yet due for re-verification this run (D-060 cadence). */
  notDue: number;
  candidatesDeleted: number;
  /** Titles handed to sources as "still missing a lineup". */
  focus: string[];
  /** Doubt resolver usage this run (D-064), when enabled. */
  doubt: DoubtUsage | null;
  /** Set when Spotify asked us to stop: nothing was written this run. */
  blockedUntil: Date | null;
};

const candidateKey = (c: { source: string; externalId: string }) =>
  `${c.source}\u0000${c.externalId}`;

export async function collectEvents(
  deps: CollectorDeps,
  sources: readonly CandidateSource[],
  opts: { mode?: CollectMode; watchTerms?: readonly string[] } = {},
): Promise<CollectReport> {
  const mode = opts.mode ?? "candidates";
  if (mode === "hold" && !deps.verification)
    throw new Error("hold mode needs a verification store");
  const now = deps.clock.now();
  const report: CollectReport = {
    mode,
    sources: [],
    events: [],
    ingest: [],
    untitled: 0,
    spotifySearches: 0,
    archived: 0,
    notDue: 0,
    candidatesDeleted: 0,
    focus: [],
    doubt: null,
    blockedUntil: null,
  };
  if (deps.verification) report.focus = await deps.verification.listMissingLineups(now);
  const candidates: EventCandidate[] = [];
  for (const source of sources) {
    const entry: SourceReport = { source: source.source, itemsSeen: 0, error: null };
    report.sources.push(entry);
    try {
      for await (const c of source.collect({
        now,
        watchTerms: opts.watchTerms,
        focus: report.focus,
      })) {
        entry.itemsSeen++;
        candidates.push(c);
      }
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      deps.logger.warn({ err: e, source: source.source }, "collector: source failed");
    }
  }

  let validated: ValidatedCandidate[];
  try {
    validated = await validateAll(deps.validator, candidates, report);
  } catch (e) {
    if (!(e instanceof SpotifyBlockedError)) throw e;
    report.blockedUntil = e.resumeAfter;
    report.spotifySearches = deps.validator.searches;
    deps.logger.warn({ resumeAfter: e.resumeAfter }, "collector: Spotify is blocked; stopping");
    return report;
  }
  report.spotifySearches = deps.validator.searches;

  if (mode !== "dry-run") {
    for (const c of validated) await deps.store.upsert(c, dedupeKey(c), now);
  }
  const remembered = await deps.store.listUpcoming(
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() - CANDIDATE_MEMORY_MS),
  );
  const linked = new Map(remembered.map((r) => [candidateKey(r.candidate), r] as const));
  const thisRun = new Set(validated.map(candidateKey));
  const pool = [
    ...validated,
    ...remembered.map((r) => r.candidate).filter((c) => !thisRun.has(candidateKey(c))),
  ];
  let clusters = clusterCandidates(pool);
  if (deps.doubt) {
    const extra = await resolveDoubts(
      deps,
      now,
      clusters,
      (c) => thisRun.has(candidateKey(c)) || mode === "hold",
    );
    report.doubt = deps.doubt.usage;
    if (extra.length > 0) {
      for (const c of extra) {
        thisRun.add(candidateKey(c));
        if (mode !== "dry-run") await deps.store.upsert(c, dedupeKey(c), now);
      }
      pool.push(...extra);
      clusters = clusterCandidates(pool);
    }
  }
  const failedSources = new Set(report.sources.filter((s) => s.error).map((s) => s.source));
  const ranSources = new Set(report.sources.map((s) => s.source));
  const persistAs = deps.persistAs ?? persistWhenEnumAllows;

  const toStore = new Map<EventSource, RawEvent[]>();
  const written: Array<{ entry: EventReport; members: ValidatedCandidate[] }> = [];
  for (const cluster of clusters) {
    const existingId =
      cluster.map((c) => linked.get(candidateKey(c))?.publishedEventId).find((id) => id) ?? null;
    const touched = cluster.some((c) => thisRun.has(candidateKey(c)));
    if (!touched && !(mode === "hold" && existingId)) continue;
    const members = [...cluster].sort(byAuthority);
    // Layer 6: a member whose complete official listing ran fine this run but dropped it.
    const vanished = members.filter(
      (m) =>
        LISTING_SOURCES.has(m.source) &&
        ranSources.has(m.source) &&
        !failedSources.has(m.source) &&
        !thisRun.has(candidateKey(m)),
    );
    // D-060: otherwise an untouched stored event is re-verified on its own schedule.
    if (!touched && existingId && vanished.length === 0) {
      const stored = await deps.verification!.get(existingId);
      if (stored && !reverificationDue(stored.startsAt, stored.lastVerifiedAt, now)) {
        report.notDue++;
        continue;
      }
    }
    const merged = mergeCluster(members);
    const verification = verifyEvent(members, await context(deps, now, cluster, clusters, merged));
    const entry: EventReport = {
      title: merged.title,
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
      city: merged.city,
      venueName: merged.venueName,
      artists: merged.artists,
      supportActs: merged.supportActs,
      sources: merged.sources.map((s) => ({ source: s.source, url: s.url })),
      verification,
      outcome: mode === "dry-run" ? "reported" : "candidate",
      detail: null,
      eventId: existingId,
    };
    report.events.push(entry);
    if (mode !== "hold") continue;

    // Layer 6: a stored event that now fails, or whose official listing dropped it.
    if (existingId && (vanished.length > 0 || !verification.passes)) {
      const current = await deps.verification!.get(existingId);
      if (current?.visibility === "published") {
        await deps.verification!.setVisibility(existingId, "held");
        entry.outcome = "unpublished";
        entry.detail =
          vanished.length > 0
            ? `no longer listed by ${vanished.map((m) => m.source).join(", ")}`
            : `failed: ${verification.flags.join(", ")}`;
        deps.logger.warn(
          { eventId: existingId, title: merged.title, reason: entry.detail },
          "collector: published event moved back to held",
        );
      }
      if (existingId) await deps.verification!.save(existingId, verification, now);
    }
    // Only events that pass layer 1 with no date/city conflict are written, always as `held`.
    const layer1 = verification.checks.filter((c) => c.layer === 1).every((c) => c.ok !== false);
    const conflict =
      verification.fields.date.status === "conflict" ||
      verification.fields.city.status === "conflict";
    if (!touched || !layer1 || conflict) {
      entry.detail ??= conflict
        ? "date or city conflict: kept as a candidate"
        : !layer1
          ? "fails layer 1: kept as a candidate"
          : null;
      continue;
    }
    entry.detail = queue(
      toStore,
      merged,
      members,
      lineupFor(merged, verification),
      persistAs,
      isCancelled(members),
    );
    if (entry.detail === null) written.push({ entry, members });
    else entry.outcome = "not_stored";
  }

  if (mode !== "hold") return report;
  for (const [source, events] of toStore) {
    try {
      report.ingest.push(await deps.ingest(staticSource(source, events), { from: now }));
    } catch (e) {
      deps.logger.error({ err: e, source }, "collector: ingest failed");
    }
  }
  for (const { entry, members } of written) {
    const wasStored = entry.eventId !== null;
    for (const m of members) {
      const source = persistAs(m.source);
      if (source === null) continue;
      const eventId = await deps.findEventId(source, m.externalId);
      if (eventId === null) continue;
      entry.eventId ??= eventId;
      await deps.store.markPublished(source, m.externalId, eventId);
    }
    if (entry.eventId) {
      if (entry.outcome === "candidate") entry.outcome = wasStored ? "held_updated" : "held_new";
      await deps.verification!.save(entry.eventId, entry.verification, now);
    }
  }
  report.archived = await deps.verification!.archivePast(now);
  report.candidatesDeleted = await deps.store.deleteStale(
    new Date(now.getTime() - CANDIDATE_MEMORY_MS),
  );
  return report;
}

/**
 * The stored lineup: when the event passes, only artists confirmed by an organiser or ≥ 2
 * independent sources; otherwise (held for review) everything Spotify confirmed.
 */
function lineupFor(
  merged: MergedEvent,
  verification: Verification,
): Array<{ name: string; tier: BillingTier }> {
  const confirmed = new Set(
    verification.fields.headliners.artists
      .filter((a) => a.confirmed)
      .map((a) => normalizeArtistName(a.name)),
  );
  const main = verification.passes
    ? merged.artists.filter((n) => confirmed.has(normalizeArtistName(n)))
    : merged.artists;
  return [
    ...main.map((name, i) => ({ name, tier: tierFromAttractionOrder(i, main.length) })),
    ...merged.supportActs.map((name) => ({ name, tier: "support" as const })),
  ];
}

/** Evidence for layers 3–4: past lineups, identities, venue geocode, series conflicts, bursts. */
async function context(
  deps: CollectorDeps,
  now: Date,
  cluster: readonly ValidatedCandidate[],
  all: readonly ValidatedCandidate[][],
  merged: MergedEvent,
) {
  const seriesKey = eventNameTokens(merged.title).join(" ");
  const pastLineups = deps.verification
    ? await deps.verification.pastLineups(seriesKey, new Date(now.getTime() - DAY_MS))
    : [];
  const identities = new Map<string, HeadlinerIdentity | null>();
  if (deps.identity) {
    for (const name of merged.artists.slice(0, IDENTITY_LOOKUPS)) {
      const id = deps.validator.spotifyIdOf(name);
      if (!id) continue;
      try {
        identities.set(normalizeArtistName(name), await deps.identity.lookup(id));
      } catch (e) {
        deps.logger.warn({ err: e, name }, "collector: identity lookup failed");
      }
    }
  }
  let venueGeoCity: string | null | undefined;
  if (deps.geocoder && merged.venueName) {
    try {
      venueGeoCity = await deps.geocoder.cityOf(merged.venueName, merged.city);
    } catch (e) {
      deps.logger.warn({ err: e, venue: merged.venueName }, "collector: geocoding failed");
    }
  }
  return {
    now,
    pastLineups,
    identities,
    venueGeoCity,
    conflictingCities: seriesCityConflicts(cluster, all, merged),
    eventsFromSameArticle: Math.max(
      ...cluster.map((c) => all.filter((other) => other.some((o) => o.url === c.url)).length),
    ),
  };
}

/**
 * D-055: other festival events of the same series around the same dates in another city.
 * An organiser source wins over sources without one (its city stands); otherwise both conflict.
 */
function seriesCityConflicts(
  cluster: readonly ValidatedCandidate[],
  all: readonly ValidatedCandidate[][],
  merged: MergedEvent,
): string[] {
  if (merged.type !== "festival") return [];
  const key = eventNameTokens(merged.title).join(" ");
  const hasOrganiser = (c: readonly ValidatedCandidate[]) =>
    c.some((m) => ORGANISER_SOURCES.has(m.source));
  const out: string[] = [];
  for (const other of all) {
    if (other === cluster) continue;
    const o = mergeCluster(other);
    if (o.type !== "festival" || eventNameTokens(o.title).join(" ") !== key) continue;
    if (Math.abs(o.startsAt.getTime() - merged.startsAt.getTime()) > SERIES_WINDOW_MS) continue;
    if (normalizeCity(o.city) === normalizeCity(merged.city)) continue;
    if (hasOrganiser(cluster) && !hasOrganiser(other)) continue;
    out.push(o.city);
  }
  return out;
}

/**
 * D-062: asks the resolver about events in doubt (by a quick layer 1–4 pass without the
 * slower identity/geocode checks) and returns the grounded, Spotify-validated candidates.
 */
async function resolveDoubts(
  deps: CollectorDeps,
  now: Date,
  clusters: readonly ValidatedCandidate[][],
  eligible: (c: ValidatedCandidate) => boolean,
): Promise<ValidatedCandidate[]> {
  const out: ValidatedCandidate[] = [];
  const only = (deps.doubtOnly ?? []).map((t) => t.toLowerCase());
  for (const cluster of clusters) {
    if (!cluster.some(eligible)) continue;
    const members = [...cluster].sort(byAuthority);
    const merged = mergeCluster(members);
    if (only.length > 0 && !only.some((t) => merged.title.toLowerCase().includes(t))) continue;
    if ((merged.endsAt ?? merged.startsAt).getTime() < now.getTime() - DAY_MS) continue;
    const reasons = doubtReasons(verifyEvent(members, { now }));
    if (reasons.length === 0) continue;
    const lead = members[0]!;
    const found = await deps.doubt!.resolve(
      {
        key: candidateKey(lead),
        title: merged.title,
        city: merged.city,
        startsAt: merged.startsAt,
      },
      reasons,
    );
    try {
      out.push(...(await validateCandidates(deps.validator, found)).validated);
    } catch (e) {
      if (e instanceof SpotifyBlockedError) break;
      throw e;
    }
  }
  return out;
}

/** Confirmed artists per candidate; candidates with no title and no confirmed artist are dropped. */
export async function validateCandidates(
  validator: ArtistValidator,
  candidates: readonly EventCandidate[],
): Promise<{ validated: ValidatedCandidate[]; untitled: number }> {
  const report = { untitled: 0 };
  const validated = await validateAll(validator, candidates, report);
  return { validated, untitled: report.untitled };
}

async function validateAll(
  validator: ArtistValidator,
  candidates: readonly EventCandidate[],
  report: { untitled: number },
): Promise<ValidatedCandidate[]> {
  const out: ValidatedCandidate[] = [];
  for (const c of candidates) {
    const artists: string[] = [];
    const supportActs: string[] = [];
    const seen = new Set<string>();
    for (const mention of c.artists) {
      for (const name of await validator.validate(mention)) {
        const key = normalizeArtistName(name);
        if (seen.has(key)) continue;
        seen.add(key);
        (mention.role === "support" ? supportActs : artists).push(name);
      }
    }
    const title = c.title ?? (artists[0] ? `${artists[0]} Live in ${c.city}` : null);
    if (title === null) {
      report.untitled++;
      continue;
    }
    out.push({ ...c, title, artists, supportActs });
  }
  return out;
}

/** Adds one RawEvent per storable member; returns why nothing could be stored, if so. */
function queue(
  toStore: Map<EventSource, RawEvent[]>,
  merged: MergedEvent,
  members: readonly ValidatedCandidate[],
  lineup: ReadonlyArray<{ name: string; tier: BillingTier }>,
  persistAs: PersistAs,
  cancelled: boolean,
): string | null {
  let stored = 0;
  const reasons: string[] = [];
  for (const member of members) {
    const source = persistAs(member.source);
    if (source === null) {
      reasons.push(`event_source enum has no '${member.source}'`);
      continue;
    }
    const raw = RawEventSchema.safeParse({
      ...toRawEvent(source, member, merged, lineup),
      ...(cancelled ? { status: "cancelled" } : {}),
    });
    if (!raw.success) {
      reasons.push(`${member.source}: ${raw.error.issues[0]?.message ?? "invalid"}`);
      continue;
    }
    toStore.set(source, [...(toStore.get(source) ?? []), raw.data]);
    stored++;
  }
  return stored > 0 ? null : [...new Set(reasons)].join("; ");
}

/**
 * Every member carries the cluster's merged facts and lineup, so whichever source the ingest
 * pipeline sees first, the stored event is the same. `raw` keeps facts and links, never text.
 */
function toRawEvent(
  source: EventSource,
  member: ValidatedCandidate,
  merged: MergedEvent,
  lineup: ReadonlyArray<{ name: string; tier: BillingTier }>,
) {
  return {
    source,
    externalId: member.externalId,
    url: member.url,
    title: merged.title,
    type: merged.type,
    startsAt: merged.startsAt,
    startsAtDateOnly: true,
    endsAt: merged.endsAt,
    venue: { name: merged.venueName ?? UNKNOWN_VENUE, city: merged.city, country: merged.country },
    lineup: lineup.map((a, i) => ({ name: a.name, billingRank: i + 1, tier: a.tier })),
    raw: {
      collector: member.source,
      trust: member.trust,
      confidence: member.confidence,
      facts: {
        title: member.title,
        startsAt: member.startsAt.toISOString(),
        city: member.city,
        venue: member.venueName,
        artists: member.artists,
        supportActs: member.supportActs,
      },
      corroboratedBy: merged.sources.filter((s) => s.externalId !== member.externalId),
    },
  };
}

function staticSource(source: EventSource, events: readonly RawEvent[]): SourceAdapter {
  return {
    source,
    async *fetch() {
      yield* events;
    },
  };
}

export type PublishResult = { eventId: EventId; published: boolean; reason: string };

/**
 * The Lead-only publish step (D-055, D-056): `held` → `published`, refused unless the stored
 * verification passed layers 1–4 and the event is still upcoming.
 */
export async function publishEvents(
  deps: { verification: EventVerificationStore; clock: Clock },
  ids: readonly EventId[],
): Promise<PublishResult[]> {
  const now = deps.clock.now();
  const out: PublishResult[] = [];
  for (const eventId of ids) {
    const e = await deps.verification.get(eventId);
    const refuse = (reason: string) => out.push({ eventId, published: false, reason });
    if (!e) refuse("no such event");
    else if (e.visibility === "archived") refuse("archived");
    else if ((e.endsAt ?? e.startsAt).getTime() < now.getTime() - DAY_MS) refuse("in the past");
    else if (!e.verification) refuse("never verified");
    else if (!e.verification.passes) refuse(`fails: ${e.verification.flags.join(", ")}`);
    else {
      await deps.verification.setVisibility(eventId, "published");
      out.push({ eventId, published: true, reason: `confidence ${e.verification.confidence}` });
    }
  }
  return out;
}

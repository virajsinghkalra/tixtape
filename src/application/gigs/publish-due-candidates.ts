/**
 * Scheduled publishing behind the strict gate (D-074; amends D-056: gate-or-Lead).
 * For every upcoming show night among the stored candidates:
 *  1. verify the night's members (D-056 layers 1–4) for the confidence score;
 *  2. look up the headliner's Spotify match and archived editions of the series;
 *  3. ask `autoPublishDecision`; record the verdict in `gate_decisions` (held reasons live there);
 *  4. on `publish`, when the switch allows it: write the event through the normal ingest
 *     (dedupe, venue, artists), check it was stored under this very night (multi-night runs
 *     must not merge, D-073), set `published`, save the verification with the gate's reasons
 *     and `reviewedBy: "auto-gate"`, and append to `publish_audit`;
 *  5. a night the gate auto-published earlier that no longer passes goes back to `held`, with
 *     an audit entry and an alert.
 * Nights never become events unless they pass; everything else stays a candidate for the Lead.
 */
import type { IngestSummary } from "@/application/events";
import type { CandidateStore, EventVerificationStore } from "@/application/ingestion/ports";
import type { Alerts } from "@/application/ports/alerts";
import type { Clock } from "@/application/ports/clock";
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import { byAuthority } from "@/domain/events/extract/corroborate";
import { verifyEvent, type Verification } from "@/domain/events/extract/verify";
import { eventNameTokens } from "@/domain/events/dedupe";
import { RawEventSchema, type RawEvent } from "@/domain/events/raw-event";
import {
  autoPublishDecision,
  firstPartyGaps,
  groundingGaps,
  pressGaps,
  type GateDecision,
  type GateSource,
} from "@/domain/gigs/auto-publish";
import { isoDate } from "@/domain/gigs/extract";
import { groupNights, toGateSource, type Night, type ValidatedGig } from "@/domain/gigs/nights";
import { atIstTime } from "@/domain/gigs/show-dates";
import type { EventId } from "@/domain/shared/ids";
import { EVENT_SOURCES, type EventSource } from "@/domain/shared/lineup";
import type { Logger } from "@/lib/logger";
import type {
  ArtistMatches,
  GateDecisionStore,
  GateRecord,
  GigCandidateReader,
  PublishAuditLog,
} from "./ports";

const DAY_MS = 86_400_000;
/** Candidates not seen for this long no longer count (D-060). */
const CANDIDATE_MEMORY_MS = 30 * DAY_MS;
export const UNKNOWN_VENUE = "Venue TBA";

export type PublishDeps = {
  candidates: GigCandidateReader;
  matches: ArtistMatches;
  verification: EventVerificationStore;
  decisions: GateDecisionStore;
  audit: PublishAuditLog;
  store: Pick<CandidateStore, "markPublished">;
  ingest(adapter: SourceAdapter, opts: SourceFetchOptions): Promise<IngestSummary>;
  findEventId(source: EventSource, externalId: string): Promise<EventId | null>;
  alerts: Alerts | null;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
};

export type NightOutcome = {
  nightKey: string;
  title: string;
  night: string;
  city: string;
  decision: GateDecision["decision"];
  /** D-089: "standard", "first_party" or "press" when the gate passed. */
  path: GateDecision["path"];
  reasons: string[];
  confidence: number;
  sources: Array<{ source: string; url: string; official: boolean }>;
  /** What this run did: decided only, published, unpublished, or why publishing was skipped. */
  action: "decided" | "published" | "already_published" | "held_again" | "skipped";
  detail: string | null;
  eventId: EventId | null;
};

export type PublishOptions = {
  /** Null: may publish. Otherwise the reason publishing is off (kill switch, pause, dry run). */
  blockedReason: string | null;
  /** Write gate decisions (false in a dry run). */
  record: boolean;
  /** This run's candidates when they weren't stored (dry run). */
  extra?: readonly ValidatedGig[];
  /** D-089 publishing paths; off by default. */
  extraPaths?: { firstParty?: boolean; press?: boolean };
};

export async function publishDueCandidates(
  deps: PublishDeps,
  opts: PublishOptions,
): Promise<NightOutcome[]> {
  const now = deps.clock.now();
  const stored = await deps.candidates.listUpcoming(
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() - CANDIDATE_MEMORY_MS),
  );
  const key = (c: ValidatedGig) => `${c.source}|${c.externalId}`;
  const fresh = new Set((opts.extra ?? []).map(key));
  const pool = [...(opts.extra ?? []), ...stored.filter((c) => !fresh.has(key(c)))];
  const outcomes: NightOutcome[] = [];
  for (const night of groupNights(pool)) {
    if (new Date(`${night.night}T00:00:00+05:30`).getTime() < now.getTime() - DAY_MS) continue;
    try {
      outcomes.push(await decideNight(deps, opts, night, now));
    } catch (e) {
      deps.logger.error({ err: e, night: night.key }, "gigs: gate failed for a night");
    }
  }
  return outcomes;
}

async function decideNight(
  deps: PublishDeps,
  opts: PublishOptions,
  night: Night,
  now: Date,
): Promise<NightOutcome> {
  const members = [...night.members].sort(byAuthority);
  const seriesKey = eventNameTokens(members[0]!.title).join(" ");
  const pastLineups = await deps.verification.pastLineups(
    seriesKey,
    new Date(now.getTime() - DAY_MS),
  );
  const verification = verifyEvent(members, { now, pastLineups });
  const match = await deps.matches.statusOf(night.headliner);
  const sources = members.map(toGateSource);
  const gate = autoPublishDecision({
    now,
    sources,
    headlinerMatch: match?.matchStatus ?? null,
    archivedLineups: pastLineups,
    confidence: verification.confidence,
    extraPaths: opts.extraPaths,
  });
  const official = factSource(members, gate, now);
  // A dry run reads nothing it would write (the table may not even be migrated yet).
  const previous = opts.record ? await deps.decisions.get(night.key) : null;
  const outcome: NightOutcome = {
    nightKey: night.key,
    title: official?.title ?? members[0]!.title,
    night: night.night,
    city: night.city,
    decision: gate.decision,
    path: gate.path,
    reasons: gate.reasons,
    confidence: gate.confidence ?? verification.confidence,
    sources: members.map((m) => ({
      source: m.source,
      url: m.url,
      official: m.provenance?.officialKind !== null && m.provenance?.officialKind !== undefined,
    })),
    action: "decided",
    detail: null,
    eventId: previous?.eventId ?? null,
  };

  if (gate.decision !== "publish") {
    if (previous?.decision === "publish" && previous.eventId && opts.record) {
      await holdAgain(deps, previous.eventId, night.key, gate, sources, now);
      outcome.action = "held_again";
    }
  } else if (opts.blockedReason) {
    outcome.action = "skipped";
    outcome.detail = opts.blockedReason;
  } else if (official) {
    await publishNight(deps, night, members, official, gate, verification, sources, outcome, now);
  }
  if (opts.record) await deps.decisions.save(toRecord(outcome, gate, sources, members, now));
  return outcome;
}

/**
 * The member whose facts are stored: the grounded official source (standard), the grounded own
 * site (first_party, D-089) or a counted press article (press, D-089). Without a publishing
 * path, the best official source, for the record. A venue another member states fills a gap
 * (the gate has already checked that venues agree).
 */
function factSource(
  members: readonly ValidatedGig[],
  gate: GateDecision,
  now: Date,
): ValidatedGig | undefined {
  const grounded = (m: ValidatedGig) => groundingGaps(toGateSource(m)).length === 0;
  const isOfficial = (m: ValidatedGig) =>
    m.provenance?.officialKind !== undefined && m.provenance.officialKind !== null;
  const pick =
    gate.path === "first_party"
      ? members.find(
          (m) => toGateSource(m).firstParty && firstPartyGaps(toGateSource(m)).length === 0,
        )
      : gate.path === "press"
        ? members.find((m) => m.provenance?.press && pressGaps(toGateSource(m), now).length === 0)
        : members.find((m) => isOfficial(m) && grounded(m));
  if (!pick) return undefined;
  return {
    ...pick,
    venueName: pick.venueName ?? members.find((m) => m.venueName)?.venueName ?? null,
  };
}

async function publishNight(
  deps: PublishDeps,
  night: Night,
  members: readonly ValidatedGig[],
  official: ValidatedGig,
  gate: GateDecision,
  verification: Verification,
  sources: GateSource[],
  outcome: NightOutcome,
  now: Date,
): Promise<void> {
  const raws = members.flatMap((m) => toRaw(m, official));
  for (const raw of raws) {
    await deps.ingest(staticSource(raw), { from: new Date(now.getTime() - DAY_MS) });
  }
  const eventId = await deps.findEventId(official.source as EventSource, official.externalId);
  if (!eventId) {
    outcome.action = "skipped";
    outcome.detail = "the ingest did not store the event";
    return;
  }
  outcome.eventId = eventId;
  const stored = await deps.verification.get(eventId);
  // D-073: a run of nights must not collapse into one event (dedupe merges ±1 day).
  if (!stored || isoDate(stored.startsAt) !== night.night) {
    outcome.action = "skipped";
    outcome.detail = `stored under ${stored ? isoDate(stored.startsAt) : "nothing"}, not ${night.night}: left for the Lead`;
    deps.logger.warn({ night: night.key, eventId }, "gigs: night merged into another event");
    return;
  }
  if (stored.visibility === "archived") {
    outcome.action = "skipped";
    outcome.detail = "event is archived";
    return;
  }
  const withGate = withGateResult(verification, gate);
  await deps.verification.save(eventId, withGate, now);
  if (stored.visibility === "published") {
    outcome.action = "already_published";
    return;
  }
  await deps.verification.setVisibility(eventId, "published");
  for (const m of members) {
    if (isEventSource(m.source)) await deps.store.markPublished(m.source, m.externalId, eventId);
  }
  await deps.audit.append({
    eventId,
    nightKey: night.key,
    action: "published",
    actor: "auto-gate",
    reasons: [
      `path: ${gate.path}`,
      ...gate.checks.map((c) => `${c.rule}: ${c.detail}`),
      ...(gate.path === "standard"
        ? []
        : [`${gate.path}: ${gate.alternatives[gate.path!].detail}`]),
    ],
    sources,
    changes: null,
    path: gate.path,
    at: now,
  });
  outcome.action = "published";
  deps.logger.info({ eventId, night: night.key }, "gigs: auto-published");
}

async function holdAgain(
  deps: PublishDeps,
  eventId: EventId,
  nightKey: string,
  gate: GateDecision,
  sources: GateSource[],
  now: Date,
): Promise<void> {
  const stored = await deps.verification.get(eventId);
  if (stored?.visibility !== "published") return;
  await deps.verification.setVisibility(eventId, "held");
  await deps.audit.append({
    eventId,
    nightKey,
    action: "held",
    actor: "auto-gate",
    reasons: gate.reasons,
    sources,
    changes: null,
    at: now,
  });
  await deps.alerts?.send({
    key: `gig-held:${eventId}`,
    subject: `Auto-published gig moved back to held: ${stored.title}`,
    body: `The gate no longer passes for ${nightKey}:\n- ${gate.reasons.join("\n- ")}`,
  });
}

const isEventSource = (s: string): s is EventSource =>
  (EVENT_SOURCES as readonly string[]).includes(s) && s !== "web";

/** One RawEvent per storable member, all carrying the official member's facts. */
function toRaw(member: ValidatedGig, official: ValidatedGig): RawEvent[] {
  if (!isEventSource(member.source)) return [];
  const time = official.provenance?.startTime ?? null;
  const lineup = [
    ...official.artists.map((name, i) => ({
      name,
      tier: i === 0 ? ("headliner" as const) : ("support" as const),
      billingRank: i + 1,
    })),
  ];
  const parsed = RawEventSchema.safeParse({
    source: member.source,
    externalId: member.externalId,
    url: member.url,
    title: official.title,
    type: official.type,
    startsAt: time ? atIstTime(official.startsAt, time) : official.startsAt,
    startsAtDateOnly: time === null,
    endsAt: null,
    venue: {
      name: official.venueName ?? UNKNOWN_VENUE,
      city: official.city,
      country: official.country,
    },
    lineup,
    raw: {
      collector: member.source,
      reviewedBy: "auto-gate",
      provenance: member.provenance ?? null,
      facts: { title: member.title, startsAt: member.startsAt.toISOString(), city: member.city },
    },
  });
  return parsed.success ? [parsed.data] : [];
}

function staticSource(raw: RawEvent): SourceAdapter {
  return {
    source: raw.source,
    async *fetch() {
      yield raw;
    },
  };
}

function toRecord(
  o: NightOutcome,
  gate: GateDecision,
  sources: readonly GateSource[],
  members: readonly ValidatedGig[],
  now: Date,
): GateRecord {
  const [, , headliner] = o.nightKey.split("|");
  return {
    nightKey: o.nightKey,
    title: o.title,
    night: o.night,
    city: o.city,
    headliner: members[0]?.artists[0] ?? headliner ?? "",
    decision: gate.decision,
    reasons:
      o.action === "skipped" && o.detail
        ? [...gate.reasons, `not published: ${o.detail}`]
        : gate.reasons,
    checks: gate.checks,
    sources: members.map((m, i) => ({
      source: m.source,
      url: m.url,
      domain: sources[i]!.domain,
      officialKind: sources[i]!.officialKind,
    })),
    confidence: o.confidence,
    path: gate.path,
    eventId: o.eventId,
    decidedAt: now,
  };
}

/**
 * The verification stored with an auto-published event: the D-056 result plus the gate's
 * verdict, its path and `reviewedBy: "auto-gate"`. First-party and press events (D-089) carry
 * the path's confidence (0.85 / 0.8); press events are marked `status: "press"` per field.
 */
export function withGateResult(verification: Verification, gate: GateDecision): Verification {
  const path = gate.path ?? "standard";
  const press = path === "press";
  const fields = press
    ? {
        ...verification.fields,
        date: { ...verification.fields.date, status: "press" as const },
        city: { ...verification.fields.city, status: "press" as const },
        headliners: { ...verification.fields.headliners, status: "press" as const },
      }
    : verification.fields;
  const result: Verification & Record<string, unknown> = {
    ...verification,
    fields,
    confidence: gate.confidence ?? verification.confidence,
    status: press ? "press" : path === "first_party" ? "first_party" : "verified",
    gate: {
      decision: gate.decision,
      path: gate.path,
      reasons: gate.reasons,
      checks: gate.checks,
      alternatives: gate.alternatives,
    },
    reviewedBy: "auto-gate",
  };
  return result;
}

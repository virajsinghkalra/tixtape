/**
 * The one write path for events, shared by ingest (P1.6) and admin entry (P1.7):
 * locate the existing event (source ref → dedupe → dedupe key), merge fields by source
 * precedence, create artists, recompute the lineup hash, and save atomically.
 */
import type { ArtistRepository } from "@/application/ports/artists";
import type {
  EventFields,
  EventRecord,
  EventRepository,
  LineupRow,
} from "@/application/ports/events";
import type { Venue } from "@/application/ports/venues";
import {
  blockingWindow,
  dedupeKey,
  duplicateScore,
  findDuplicate,
  mayOverwrite,
  mergeEventFields,
  mergeGuard,
  sourceRank,
  topSource,
} from "@/domain/events/dedupe";
import type { CreditOptions } from "@/domain/events/credits";
import { buildLineup, lineupHash, type LineupEntry } from "@/domain/events/lineup";
import { normalizeArtistName, splitArtistCredit } from "@/domain/shared/normalize";
import type { RawEvent, RawLineupEntry } from "@/domain/events/raw-event";
import type { EventVisibility } from "@/domain/events/visibility";
import type { EventId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";

export type EventWriterDeps = {
  events: EventRepository;
  artists: ArtistRepository;
  clock: { now(): Date };
};

/** A source's event after its venue has been resolved. `lineup: null` keeps the stored lineup. */
export type EventInput = Omit<RawEvent, "venue" | "lineup"> & {
  venue: Venue;
  lineup: readonly RawLineupEntry[] | null;
  /** Only an admin sets this (D-056); sources never do, so their events start `held`. */
  visibility?: EventVisibility;
};

export type WriteOutcome =
  /** No existing event matched. */
  | { kind: "created"; eventId: EventId }
  /** Dedupe scored between the review and merge thresholds: created separately, flagged. */
  | { kind: "created_for_review"; eventId: EventId; similarTo: EventId; score: number }
  /** Merged into an event first seen from another source (or with the same dedupe key). */
  | { kind: "merged"; eventId: EventId; score: number | null }
  /** The same source (or an admin edit) updated its own event. */
  | { kind: "updated"; eventId: EventId };

type Target =
  | { kind: "created" }
  | { kind: "created_for_review"; similarTo: EventId; score: number }
  | { kind: "merged" | "updated"; id: EventId; score: number | null };

/** `targetId` forces an update of that event (admin edit); otherwise the event is located. */
export async function writeEvent(
  deps: EventWriterDeps,
  input: EventInput,
  targetId?: EventId,
): Promise<WriteOutcome> {
  const lineup =
    input.lineup === null
      ? null
      : buildLineup(input.lineup, await creditOptions(deps.artists, input));
  let target: Target = targetId
    ? { kind: "updated", id: targetId, score: null }
    : await locate(deps.events, input, lineup ?? []);
  let existing = "id" in target ? await deps.events.findById(target.id) : null;
  if ("id" in target && !existing) throw new NotFoundError("That event no longer exists.");
  // D-072: a merge may move the start only for a strictly higher-ranked source. An equal
  // rank with a different start is two records of possibly different shows: review them.
  if (target.kind === "merged" && existing && startWouldMove(input, existing)) {
    target = { kind: "created_for_review", similarTo: existing.id, score: target.score ?? 1 };
    existing = null;
  }

  const overwrite = existing === null || mayOverwrite(input.source, existing.sources);
  const fields = mergedFields(input, existing, overwrite);
  const replaceLineup =
    lineup !== null && lineup.length > 0 && (overwrite || existing?.lineupHash === null);

  const eventId = await deps.events.save({
    id: existing?.id ?? null,
    fields,
    dedupeKey: await storedKey(deps.events, existing, {
      title: fields.title,
      startsAt: fields.startsAt,
      city: input.venue.city,
    }),
    source: {
      source: input.source,
      externalId: input.externalId,
      url: input.url ?? null,
      raw: input.raw,
      seenAt: deps.clock.now(),
    },
    lineup: replaceLineup ? await lineupRows(deps.artists, lineup) : null,
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
  });

  if (target.kind === "created") return { kind: "created", eventId };
  if (target.kind === "created_for_review") return { ...target, eventId };
  if (target.kind === "merged") return { kind: "merged", eventId, score: target.score };
  return { kind: "updated", eventId };
}

async function locate(
  events: EventRepository,
  input: EventInput,
  lineup: readonly LineupEntry[],
): Promise<Target> {
  if (input.externalId !== null) {
    const id = await events.findIdBySourceRef(input.source, input.externalId);
    if (id) return { kind: "updated", id, score: null };
  }
  const subject = {
    title: input.title,
    startsAt: input.startsAt,
    country: input.venue.country,
    city: input.venue.city,
    venueName: input.venue.name,
    artistKeys: lineup.map((e) => e.normalizedName),
    startsAtDateOnly: input.startsAtDateOnly ?? false,
    sources: [input.source],
  };
  const candidates = await events.listDedupeCandidates({
    country: subject.country,
    city: subject.city,
    ...blockingWindow(subject.startsAt),
  });
  const match = findDuplicate(subject, candidates);
  if (match.decision === "merge")
    return { kind: "merged", id: match.candidate.id, score: match.score };

  // Same normalized title, date and city is the same event even when venue or lineup
  // differ, unless the merge guard says these are different nights (D-072).
  const sameKey = await events.findIdByDedupeKey(dedupeKey(subject));
  if (sameKey) {
    const stored = candidates.find((c) => c.id === sameKey);
    const guard = stored ? mergeGuard(subject, stored) : "allow";
    if (guard === "allow") return { kind: "merged", id: sameKey, score: null };
    if (guard === "review" && match.decision !== "review") {
      return {
        kind: "created_for_review",
        similarTo: sameKey,
        score: duplicateScore(subject, stored!),
      };
    }
  }

  if (match.decision === "review") {
    return { kind: "created_for_review", similarTo: match.candidate.id, score: match.score };
  }
  return { kind: "created" };
}

/**
 * D-091: how to split this source's credits. Admin lineups (the Lead and Data teams) are
 * verified and kept exactly as given. Other sources split, except a credit that is already a
 * known artist or alias ("TOMORROW X TOGETHER" once matched) or on the known-acts list.
 */
async function creditOptions(artists: ArtistRepository, input: EventInput): Promise<CreditOptions> {
  if (input.source === "admin") return { split: false };
  const known = new Set<string>();
  for (const entry of input.lineup ?? []) {
    if (splitArtistCredit(entry.name).length < 2) continue;
    const key = normalizeArtistName(entry.name);
    if (key !== "" && (await artists.findByAlias(key))) known.add(key);
  }
  return { isKnownAct: (name) => known.has(normalizeArtistName(name)) };
}

/**
 * True when merging would overwrite the start with a different one from a source that is
 * only as trusted as the event's owner. Lower ranks never overwrite it (they only fill
 * gaps), and a strictly higher rank may correct it.
 */
function startWouldMove(input: EventInput, existing: EventRecord): boolean {
  const top = topSource(existing.sources);
  const equalRank = top !== null && sourceRank(input.source) === sourceRank(top);
  const moves =
    input.startsAt.getTime() !== existing.startsAt.getTime() ||
    (input.startsAtDateOnly ?? false) !== existing.startsAtDateOnly;
  return moves && equalRank;
}

/**
 * `events.dedupe_key` for this write. Two separate shows can share title, city and UTC date
 * (an early and a late show, or 19:30 and 00:30 IST); the second gets its start time
 * appended so it can be stored, and keeps that key on later updates (D-072).
 */
async function storedKey(
  events: EventRepository,
  existing: EventRecord | null,
  input: { title: string; startsAt: Date; city: string },
): Promise<string> {
  const base = dedupeKey(input);
  if (existing) return existing.dedupeKey.startsWith(`${base}|`) ? existing.dedupeKey : base;
  const taken = await events.findIdByDedupeKey(base);
  return taken ? `${base}|${input.startsAt.toISOString().slice(11, 16)}` : base;
}

function mergedFields(
  input: EventInput,
  existing: EventRecord | null,
  overwrite: boolean,
): EventFields {
  const incoming: { [K in keyof EventFields]?: EventFields[K] } = {
    title: input.title,
    type: input.type,
    status: input.status,
    startsAt: input.startsAt,
    // Always known alongside startsAt, so a source that later sends a real time clears it.
    startsAtDateOnly: input.startsAtDateOnly ?? false,
    endsAt: input.endsAt,
    genre: input.genre,
    imageUrl: input.imageUrl,
    venueId: input.venue.id,
  };
  if (existing === null) {
    return {
      title: input.title,
      type: input.type,
      status: input.status ?? "announced",
      startsAt: input.startsAt,
      startsAtDateOnly: input.startsAtDateOnly ?? false,
      endsAt: input.endsAt ?? null,
      genre: input.genre ?? null,
      imageUrl: input.imageUrl ?? null,
      venueId: input.venue.id,
    };
  }
  const { id: _id, dedupeKey: _key, lineupHash: _hash, sources: _sources, ...current } = existing;
  return mergeEventFields<EventFields>(current, incoming, overwrite);
}

/**
 * Finds or creates each artist. Two spellings can resolve to one artist through an alias;
 * the artist keeps its highest billing and ranks are renumbered so they stay 1..n.
 */
async function lineupRows(
  artists: ArtistRepository,
  lineup: readonly LineupEntry[],
): Promise<{ rows: LineupRow[]; hash: string }> {
  const rows: LineupRow[] = [];
  const kept: LineupEntry[] = [];
  const seen = new Set<string>();
  for (const entry of lineup) {
    const artist = await artists.findOrCreateByName(entry.name, entry.normalizedName);
    if (seen.has(artist.id)) continue;
    seen.add(artist.id);
    kept.push(entry);
    rows.push({
      artistId: artist.id,
      billingRank: rows.length + 1,
      tier: entry.tier,
      day: entry.day,
      stage: entry.stage,
    });
  }
  return { rows, hash: lineupHash(kept) };
}

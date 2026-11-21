/**
 * Admin event entry (P1.7). Admin is the highest-precedence source (LLD §5.3), so its
 * values overwrite anything a feed set, and feeds never overwrite them afterwards.
 */
import { z } from "zod";
import type {
  AdminEventDetail,
  EventDetail,
  EventMerge,
  EventRepository,
} from "@/application/ports/events";
import type { Venue, VenueRepository } from "@/application/ports/venues";
import {
  ARTIST_LIMIT_MESSAGE,
  fitsArtistLimit,
  MAX_LINEUP_CREDITS,
  RawVenueSchema,
  type RawLineupEntry,
} from "@/domain/events/raw-event";
import { httpUrl } from "@/domain/events/http-url";
import { EVENT_VISIBILITIES } from "@/domain/events/visibility";
import type { EventId } from "@/domain/shared/ids";
import { BILLING_TIERS, EVENT_STATUSES, EVENT_TYPES } from "@/domain/shared/lineup";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { resolveVenue } from "./resolve-venue";
import { writeEvent, type EventInput, type EventWriterDeps } from "./write-event";

// D-018: request input rejects unknown keys (strictObject throughout).
const isoDateTime = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const AdminLineupItemSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  tier: z.enum(BILLING_TIERS),
  /** Defaults to the item's 1-based position in the list. */
  billingRank: z.number().int().positive().optional(),
  day: z.number().int().min(1).max(31).nullish(),
  stage: z.string().trim().min(1).max(100).nullish(),
});

const AdminLineupSchema = z
  .array(AdminLineupItemSchema)
  .min(1, "Add at least one artist.")
  .max(MAX_LINEUP_CREDITS, `A lineup can have at most ${MAX_LINEUP_CREDITS} entries.`)
  .transform((items): RawLineupEntry[] =>
    items.map((item, i) => ({ ...item, billingRank: item.billingRank ?? i + 1 })),
  )
  .refine((items) => new Set(items.map((i) => i.billingRank)).size === items.length, {
    message: "Billing ranks must be unique.",
  })
  // Lead decision: the 300 limit counts artists after credit splitting, not credits.
  .refine(fitsArtistLimit, ARTIST_LIMIT_MESSAGE);

const adminEventShape = {
  title: z.string().trim().min(1).max(300),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable(),
  genre: z.string().trim().min(1).max(100).nullable(),
  imageUrl: httpUrl().nullable(),
  url: httpUrl().nullable(),
  venue: RawVenueSchema,
  lineup: AdminLineupSchema,
  /** D-056: omitted on create means `held`; "published" must be chosen explicitly. */
  visibility: z.enum(EVENT_VISIBILITIES),
};

const endsAfterStart = (e: { startsAt?: Date; endsAt?: Date | null }) =>
  !e.startsAt || !e.endsAt || e.endsAt >= e.startsAt;
const endsAfterStartIssue = { message: "endsAt must not be before startsAt.", path: ["endsAt"] };
const toIssue = (i: typeof endsAfterStartIssue) => ({ path: i.path.join("."), message: i.message });

export const AdminEventInputSchema = z
  .strictObject({
    ...adminEventShape,
    status: adminEventShape.status.default("announced"),
    endsAt: adminEventShape.endsAt.default(null),
    genre: adminEventShape.genre.default(null),
    imageUrl: adminEventShape.imageUrl.default(null),
    url: adminEventShape.url.default(null),
    visibility: adminEventShape.visibility.optional(),
  })
  .refine(endsAfterStart, endsAfterStartIssue);
export type AdminEventInput = z.infer<typeof AdminEventInputSchema>;

/** Every field optional; a given `lineup` replaces the whole lineup. */
export const AdminEventPatchSchema = z
  .strictObject(adminEventShape)
  .partial()
  .refine(endsAfterStart, endsAfterStartIssue);
export type AdminEventPatch = z.infer<typeof AdminEventPatchSchema>;

export type AdminSaveDeps = Omit<EventWriterDeps, "events"> & {
  /** `recordMergeReview`: a possible duplicate goes to the review queue (D-028, D-072). */
  events: EventRepository & Pick<EventMerge, "recordMergeReview">;
  venues: VenueRepository;
};

export type AdminSaveResult = {
  /** With `visibility`, `confidence`, `lastVerifiedAt` (admin view, D-056). */
  event: AdminEventDetail;
  /** `merged`: an existing event (e.g. from Ticketmaster) matched and now carries the admin data. */
  outcome: "created" | "merged" | "updated";
};

export async function createAdminEvent(
  deps: AdminSaveDeps,
  input: AdminEventInput,
): Promise<AdminSaveResult> {
  const venue = await resolveVenue(deps.venues, input.venue);
  const outcome = await writeEvent(deps, toEventInput(input, venue));
  if (outcome.kind === "created_for_review") {
    // D-028/D-072: a possible duplicate (or another night of the same show) goes to the
    // review queue instead of being merged.
    await deps.events.recordMergeReview(outcome.eventId, outcome.similarTo, outcome.score);
  }
  const kind = outcome.kind === "created_for_review" ? "created" : outcome.kind;
  return { event: await detail(deps.events, outcome.eventId), outcome: kind };
}

export async function updateAdminEvent(
  deps: AdminSaveDeps,
  id: EventId,
  patch: AdminEventPatch,
): Promise<AdminSaveResult> {
  const { visibility, ...edits } = patch;
  // Publishing/holding/archiving is not an edit: no admin source row, so ownership and
  // source precedence (D-026) stay as they were (QA-E-7).
  if (Object.keys(edits).length === 0) {
    if (visibility !== undefined && !(await deps.events.setVisibility(id, visibility))) {
      throw new NotFoundError("That event doesn't exist.");
    }
    return { event: await detail(deps.events, id), outcome: "updated" };
  }
  const current = await deps.events.getDetail(id);
  if (!current) throw new NotFoundError("That event doesn't exist.");
  const endsAt = patch.endsAt === undefined ? current.endsAt : patch.endsAt;
  const startsAt = patch.startsAt ?? current.startsAt;
  if (endsAt && endsAt < startsAt) {
    throw new ValidationError("Request is invalid.", [endsAfterStartIssue].map(toIssue));
  }
  const venue = patch.venue
    ? await resolveVenue(deps.venues, patch.venue)
    : await currentVenue(deps.venues, current);
  const merged: EventInput = {
    source: "admin",
    externalId: null,
    url: patch.url,
    raw: patch,
    title: patch.title ?? current.title,
    type: patch.type ?? current.type,
    status: patch.status ?? current.status,
    startsAt,
    endsAt,
    genre: patch.genre === undefined ? current.genre : patch.genre,
    imageUrl: patch.imageUrl === undefined ? current.imageUrl : patch.imageUrl,
    venue,
    lineup: patch.lineup ?? null,
    ...(patch.visibility === undefined ? {} : { visibility: patch.visibility }),
  };
  await writeEvent(deps, merged, id);
  return { event: await detail(deps.events, id), outcome: "updated" };
}

function toEventInput(input: AdminEventInput, venue: Venue): EventInput {
  const { venue: _venue, lineup, ...fields } = input;
  return { ...fields, source: "admin", externalId: null, raw: input, venue, lineup };
}

async function currentVenue(venues: VenueRepository, current: EventDetail): Promise<Venue> {
  const venue = current.venue ? await venues.findById(current.venue.id) : null;
  if (!venue) throw new NotFoundError("This event has no venue. Include one in the update.");
  return venue;
}

async function detail(events: EventRepository, id: EventId): Promise<AdminEventDetail> {
  const event = await events.getDetail(id);
  if (!event) throw new NotFoundError("That event no longer exists.");
  return event;
}

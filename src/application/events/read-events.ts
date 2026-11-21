/** Public and admin event reads (P1.7, LLD §9). */
import { z } from "zod";
import type {
  AdminEventDetail,
  AdminEventSummary,
  EventAdminFields,
  EventDetail,
  EventRepository,
  EventSummary,
} from "@/application/ports/events";
import {
  EVENT_VISIBILITIES,
  PUBLIC_VISIBILITY,
  type EventVisibility,
} from "@/domain/events/visibility";
import { canonicalCity } from "@/domain/events/venue";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { EVENT_TYPES, type EventSource } from "@/domain/shared/lineup";
import { NotFoundError } from "@/lib/errors";

const DAY_MS = 86_400_000;

/** A date ("2026-03-07") or a date-time with offset. */
export const dateOrDateTime = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

/** For an upper bound: a bare date includes that whole (UTC) day. */
export function endOfDayIfDate(value: string): Date {
  return value.length === 10 ? new Date(new Date(value).getTime() + DAY_MS - 1) : new Date(value);
}

const listShape = {
  city: z.string().trim().min(1).max(100).optional(),
  from: dateOrDateTime.optional(),
  /** A bare date includes that whole (UTC) day. */
  to: dateOrDateTime.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  type: z.enum(EVENT_TYPES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const withDates = <T extends { from?: string; to?: string }>(q: T) => ({
  ...q,
  from: q.from === undefined ? undefined : new Date(q.from),
  to: q.to === undefined ? undefined : endOfDayIfDate(q.to),
});
const fromBeforeTo = (q: { from?: Date; to?: Date }) => !q.from || !q.to || q.from <= q.to;
const fromBeforeToIssue = { message: "from must not be after to.", path: ["from"] };

/** D-018: unknown query parameters are rejected. */
export const ListEventsQuerySchema = z
  .strictObject(listShape)
  .transform(withDates)
  .refine(fromBeforeTo, fromBeforeToIssue);
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

/** Admin list: every visibility unless one is asked for (D-056). */
export const AdminListEventsQuerySchema = z
  .strictObject({ ...listShape, visibility: z.enum(EVENT_VISIBILITIES).optional() })
  .transform(withDates)
  .refine(fromBeforeTo, fromBeforeToIssue);
export type AdminListEventsQuery = z.infer<typeof AdminListEventsQuerySchema>;

export type EventPage = { items: EventSummary[]; page: number; pageSize: number; total: number };
export type AdminEventPage = Omit<EventPage, "items"> & { items: AdminEventSummary[] };

async function listPage(
  events: EventRepository,
  query: ListEventsQuery,
  visibility: EventVisibility | null,
): Promise<AdminEventPage> {
  const { items, total } = await events.list({
    visibility,
    city: query.city === undefined ? undefined : canonicalCity(query.city),
    from: query.from,
    to: query.to,
    q: query.q,
    type: query.type,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });
  return { items, page: query.page, pageSize: query.pageSize, total };
}

/** Public list: published events only (D-056), without verification internals. */
export async function listEvents(
  events: EventRepository,
  query: ListEventsQuery,
): Promise<EventPage> {
  const page = await listPage(events, query, PUBLIC_VISIBILITY);
  return { ...page, items: page.items.map(withoutAdminFields) };
}

export async function listAdminEvents(
  events: EventRepository,
  query: AdminListEventsQuery,
): Promise<AdminEventPage> {
  return listPage(events, query, query.visibility ?? null);
}

/** A malformed ID is a missing event, not a bad request: it can't name anything. */
export function parseEventId(raw: string): EventId {
  if (!z.uuid().safeParse(raw).success) throw new NotFoundError("That event doesn't exist.");
  return asEventId(raw);
}

/** What the UI shows as "✓ Verified from N sources · checked 2h ago" (D-056). */
export type EventVerification = {
  /** Independent outside sources; admin entry isn't counted. */
  sourcesCount: number;
  lastVerifiedAt: Date | null;
  sources: { source: EventSource; url: string | null }[];
};

/**
 * `getEvent` always sets `verification`; it's typed optional so a plain `EventDetail`
 * still satisfies this type for existing callers.
 */
export type PublicEventDetail = EventDetail & { verification?: EventVerification };

/**
 * Public detail: a held or archived event is a 404, exactly like a missing one (D-056).
 * The Playlist Engine reads events through this too, so unpublished events get no playlist.
 */
export async function getEvent(events: EventRepository, id: EventId): Promise<PublicEventDetail> {
  const event = await events.getDetail(id);
  if (!event || event.visibility !== PUBLIC_VISIBILITY) {
    throw new NotFoundError("That event doesn't exist.");
  }
  const outside = event.sources.filter((s) => s.source !== "admin");
  return {
    ...withoutAdminFields(event),
    verification: {
      sourcesCount: outside.length,
      lastVerifiedAt: event.lastVerifiedAt,
      sources: outside.map((s) => ({ source: s.source, url: s.url })),
    },
  };
}

/** Admin detail: any visibility, with verification state. */
export async function getAdminEvent(
  events: EventRepository,
  id: EventId,
): Promise<AdminEventDetail> {
  const event = await events.getDetail(id);
  if (!event) throw new NotFoundError("That event doesn't exist.");
  return event;
}

function withoutAdminFields<T extends EventAdminFields>(e: T): Omit<T, keyof EventAdminFields> {
  const { visibility: _v, confidence: _c, lastVerifiedAt: _l, ...rest } = e;
  return rest;
}

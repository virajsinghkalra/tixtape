/**
 * Events & Ingestion use cases bound to their ports (P1.4–P1.7). Infrastructure builds the
 * ports (src/infrastructure/events-module.ts); routes reach this through src/server/events.ts.
 */
import { listNeedingImage } from "./image-holds";
import type { EventVisualRow } from "@/application/ports/events";
import type { ArtistRepository } from "@/application/ports/artists";
import type { EventEngagement, RateLimiter, SearchLog } from "@/application/ports/engagement";
import type { EventSearch } from "@/application/ports/event-search";
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import type { EventMerge, EventRepository } from "@/application/ports/events";
import type { IngestRunRepository } from "@/application/ports/ingest-runs";
import type { VenueRepository } from "@/application/ports/venues";
import type { EventId } from "@/domain/shared/ids";
import type { Logger } from "@/lib/logger";
import { ingestEvents, type IngestSummary } from "./ingest-events";
import {
  getAdminEvent,
  getEvent,
  listAdminEvents,
  listEvents,
  type AdminEventPage,
  type AdminEventView,
  type AdminListEventsQuery,
  type EventPage,
  type ListEventsQuery,
  type PublicEventDetail,
} from "./read-events";
import {
  createAdminEvent,
  updateAdminEvent,
  type AdminEventInput,
  type AdminEventPatch,
  type AdminSaveResult,
} from "./save-admin-event";
import {
  recordEventView,
  recordPlaylistOpen,
  recordSearchClick,
  type EngagementResult,
  type SearchClick,
} from "./engagement";
import {
  searchPage,
  suggest,
  type SearchPageParams,
  type SearchPageResponse,
  type SuggestParams,
  type SuggestResponse,
} from "./search-events";

export type { IngestSummary } from "./ingest-events";
export type { EventVisualRow } from "@/application/ports/events";
export { listNeedingImage, retryImageHolds } from "./image-holds";
export type { ImageRetryResult } from "./image-holds";
export type {
  AdminEventPage,
  AdminEventView,
  AdminListEventsQuery,
  EventPage,
  EventVerification,
  ListEventsQuery,
  PublicEventDetail,
} from "./read-events";
export { AdminListEventsQuerySchema, ListEventsQuerySchema, parseEventId } from "./read-events";
export type { AdminEventInput, AdminEventPatch, AdminSaveResult } from "./save-admin-event";
export { AdminEventInputSchema, AdminEventPatchSchema } from "./save-admin-event";
export type {
  SearchGroups,
  SearchPageParams,
  SearchPageResponse,
  SuggestParams,
  SuggestResponse,
} from "./search-events";
export { SearchPageParamsSchema, SuggestParamsSchema } from "./search-events";
export type { EngagementResult, SearchClick } from "./engagement";
export { SearchClickSchema } from "./engagement";
export type { ArtistEntity, CityEntity, MatchReason, Suggestion } from "@/domain/events/search";

/** D-047 §6: anonymous search logs are kept 90 days. */
const SEARCH_LOG_TTL_MS = 90 * 86_400_000;

export type EventsUseCases = {
  /** Published events only (D-056). */
  listEvents(query: ListEventsQuery): Promise<EventPage>;
  /** Published only: held, archived or missing → `NotFoundError`. Adds `verification`. */
  getEvent(id: EventId): Promise<PublicEventDetail>;
  /** Admin: every visibility, with verification state. */
  listAdminEvents(query: AdminListEventsQuery): Promise<AdminEventPage>;
  /** Admin: any visibility. Throws `NotFoundError`. */
  getAdminEvent(id: EventId): Promise<AdminEventView>;
  createAdminEvent(input: AdminEventInput): Promise<AdminSaveResult>;
  /** Throws `NotFoundError`, `ValidationError`, `ConflictError`. */
  updateAdminEvent(id: EventId, patch: AdminEventPatch): Promise<AdminSaveResult>;
  /** Throws the adapter's `UpstreamError` after recording the failed run. */
  ingest(adapter: SourceAdapter, opts: SourceFetchOptions): Promise<IngestSummary>;
  /** Type-ahead (D-042, D-047): groups for text, recommendation sections for an empty query. */
  suggest(params: SuggestParams): Promise<SuggestResponse>;
  /** Full results page (D-048), same engine, paginated. Logs committed queries. */
  searchPage(params: SearchPageParams): Promise<SearchPageResponse>;
  /** Throw `NotFoundError` / `RateLimitedError`. `clientKey` is only used in memory. */
  recordEventView(eventId: EventId, clientKey: string): Promise<EngagementResult>;
  recordSearchClick(click: SearchClick, clientKey: string): Promise<EngagementResult>;
  /** For the Playlist Engine: a playlist for this event was opened. */
  recordPlaylistOpen(eventId: EventId, clientKey: string): Promise<EngagementResult>;
  /** Admin list of queries that found nothing (D-047 §6). */
  listZeroResultQueries(since: Date, limit: number): Promise<{ query: string; count: number }[]>;
  /** D-091: upcoming published events with no poster and no headliner photo (admin view, digest). */
  listEventsNeedingImage(): Promise<EventVisualRow[]>;
  /** The sweep: delete search logs older than 90 days. */
  pruneSearchLog(): Promise<number>;
};

export type EventsPorts = {
  /** D-028: ingest records possible duplicates for review. */
  events: EventRepository & EventMerge;
  venues: VenueRepository;
  artists: ArtistRepository;
  ingestRuns: IngestRunRepository;
  search: EventSearch;
  engagement: EventEngagement;
  searchLog: SearchLog;
  clientLimiter: RateLimiter;
  repeatLimiter: RateLimiter;
  clock: { now(): Date };
  logger: Pick<Logger, "info" | "warn" | "error">;
};

export function createEventsUseCases(ports: EventsPorts): EventsUseCases {
  return {
    listEvents: (query) => listEvents(ports.events, query),
    getEvent: (id) => getEvent(ports.events, id),
    listAdminEvents: (query) => listAdminEvents(ports.events, query),
    getAdminEvent: (id) => getAdminEvent(ports.events, id),
    createAdminEvent: (input) => createAdminEvent(ports, input),
    updateAdminEvent: (id, patch) => updateAdminEvent(ports, id, patch),
    ingest: (adapter, opts) => ingestEvents(ports, adapter, opts),
    suggest: (params) => suggest(ports, params),
    searchPage: (params) => searchPage(ports, params),
    recordEventView: (id, key) => recordEventView(ports, id, key),
    recordSearchClick: (click, key) => recordSearchClick(ports, click, key),
    recordPlaylistOpen: (id, key) => recordPlaylistOpen(ports, id, key),
    listZeroResultQueries: (since, limit) => ports.searchLog.listZeroResultQueries(since, limit),
    listEventsNeedingImage: () => listNeedingImage(ports.events, ports.clock.now()),
    pruneSearchLog: () =>
      ports.searchLog.deleteOlderThan(new Date(ports.clock.now().getTime() - SEARCH_LOG_TTL_MS)),
  };
}

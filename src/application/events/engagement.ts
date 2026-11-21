/**
 * Popularity signals (D-047 §4): event views, search clicks and playlist opens bump the
 * decayed `trend_score`. Anonymous: the client key (an IP) is used only for in-memory rate
 * limits and never stored.
 */
import { z } from "zod";
import type { EventEngagement, RateLimiter, SearchLog } from "@/application/ports/engagement";
import { SUGGEST_MAX_LENGTH, tidyQuery } from "@/domain/events/search";
import { foldText } from "@/domain/events/text";
import type { EngagementKind } from "@/domain/events/trend";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { NotFoundError, RateLimitedError } from "@/lib/errors";

const NOT_FOUND = "That event doesn't exist.";
import type { Logger } from "@/lib/logger";

export type EngagementDeps = {
  engagement: EventEngagement;
  searchLog: SearchLog;
  /** Per client: how many signals it may send (429 beyond that). */
  clientLimiter: RateLimiter;
  /** Per client and event: repeats inside the window are accepted but not counted. */
  repeatLimiter: RateLimiter;
  clock: { now(): Date };
  logger: Pick<Logger, "warn">;
};

/** D-018: strict. `q` may be empty for clicks on zero-query recommendations. */
export const SearchClickSchema = z.strictObject({
  q: z
    .string()
    .transform(tidyQuery)
    .refine((q) => [...q].length <= SUGGEST_MAX_LENGTH, { message: "q is too long." })
    .default(""),
  eventId: z.uuid().transform(asEventId),
});
export type SearchClick = z.infer<typeof SearchClickSchema>;

/** `counted` is false when this client already sent this signal for this event recently. */
export type EngagementResult = { counted: boolean };

async function bump(
  deps: EngagementDeps,
  kind: EngagementKind,
  eventId: EventId,
  clientKey: string,
): Promise<EngagementResult> {
  const now = deps.clock.now();
  if (!(await deps.clientLimiter.take(`${kind}:${clientKey}`, now))) {
    throw new RateLimitedError("Too many requests. Try again in a minute.", 60);
  }
  // Checked before the repeat limiter so a hidden event never gets a different answer
  // from a missing one (D-056).
  if (!(await deps.engagement.isPublished(eventId))) throw new NotFoundError(NOT_FOUND);
  if (!(await deps.repeatLimiter.take(`${kind}:${clientKey}:${eventId}`, now)))
    return { counted: false };
  await deps.engagement.record(eventId, kind, now);
  return { counted: true };
}

/** `POST /api/events/:id/view`. Throws `NotFoundError`, `RateLimitedError`. */
export function recordEventView(deps: EngagementDeps, eventId: EventId, clientKey: string) {
  return bump(deps, "view", eventId, clientKey);
}

/** Playlist Engine calls this when a playlist for the event is opened (weight 5). */
export function recordPlaylistOpen(deps: EngagementDeps, eventId: EventId, clientKey: string) {
  return bump(deps, "playlist_open", eventId, clientKey);
}

/** `POST /api/search/click`: a committed search (D-048). Throws `NotFoundError`, `RateLimitedError`. */
export async function recordSearchClick(
  deps: EngagementDeps,
  click: SearchClick,
  clientKey: string,
): Promise<EngagementResult> {
  const result = await bump(deps, "search_click", click.eventId, clientKey);
  const q = foldText(click.q);
  if (result.counted && q !== "") {
    try {
      await deps.searchLog.recordClick(q, click.eventId, deps.clock.now());
    } catch (e) {
      deps.logger.warn({ err: e }, "search: failed to log click");
    }
  }
  return result;
}

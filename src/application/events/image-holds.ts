/**
 * D-091: events kept off the site for want of a picture.
 * - `retryImageHolds` (daily): held `no_image` events get the image providers run for them
 *   (poster, headliner photos); each is published as soon as it has a picture. A Spotify
 *   match made meanwhile counts too, since it brings the artist's photo.
 * - `listNeedingImage`: published events without a picture are never unpublished; they're
 *   listed for the admin "needs image" view and the daily digest.
 */
import type { EventRepository, EventVisualRow } from "@/application/ports/events";
import type { EventVerificationStore } from "@/application/ingestion/ports";
import { checkPublishVisual } from "@/domain/events/publish-visual";
import type { EventId } from "@/domain/shared/ids";
import type { Logger } from "@/lib/logger";
import { publishIfVisual, type VisualPublishResult } from "./publish-visual";

export type ImageRetryDeps = {
  store: Pick<
    EventVerificationStore,
    "listImageHolds" | "visualOf" | "setVisibility" | "setImageHold"
  >;
  /** Runs the D-083 image providers for one event (poster and headliner photos). */
  fillForEvent(eventId: EventId): Promise<unknown>;
  clock: { now(): Date };
  logger: Pick<Logger, "warn">;
};

export type ImageRetryResult = {
  eventId: EventId;
  result: VisualPublishResult | { error: string };
};

export async function retryImageHolds(
  deps: ImageRetryDeps,
  limit = 50,
): Promise<ImageRetryResult[]> {
  const out: ImageRetryResult[] = [];
  for (const eventId of await deps.store.listImageHolds(deps.clock.now(), limit)) {
    try {
      // Only search when it still has nothing: a Spotify match may have brought a photo.
      if (!checkPublishVisual(await deps.store.visualOf(eventId)).ok) {
        await deps.fillForEvent(eventId);
      }
      out.push({ eventId, result: await publishIfVisual(deps.store, eventId) });
    } catch (e) {
      // One event's provider failure must not stop the others; it stays held for tomorrow.
      deps.logger.warn({ err: e, eventId }, "images: retry failed");
      out.push({ eventId, result: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return out;
}

/** Upcoming published events with no poster and no headliner photo. */
export async function listNeedingImage(
  events: Pick<EventRepository, "listVisuals">,
  now: Date,
  limit = 200,
): Promise<EventVisualRow[]> {
  const rows = await events.listVisuals("published", now, limit);
  return rows.filter((r) => !checkPublishVisual(r.visual).ok);
}

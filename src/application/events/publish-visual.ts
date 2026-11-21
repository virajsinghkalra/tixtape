/**
 * D-091: the one way automatic paths publish. Checks the image rule on the stored event:
 * with a poster or a headliner photo it publishes; without one it stays `held`, marked
 * `no_image` so the daily retry picks it up once a picture exists.
 */
import type { EventVerificationStore } from "@/application/ingestion/ports";
import { checkPublishVisual, NO_IMAGE } from "@/domain/events/publish-visual";
import type { EventId } from "@/domain/shared/ids";

export type VisualPublishStore = Pick<
  EventVerificationStore,
  "visualOf" | "setVisibility" | "setImageHold"
>;

export type VisualPublishResult =
  | { published: true; via: "poster" | "headliner_photo" }
  | { published: false; reason: typeof NO_IMAGE };

export async function publishIfVisual(
  store: VisualPublishStore,
  eventId: EventId,
): Promise<VisualPublishResult> {
  const check = checkPublishVisual(await store.visualOf(eventId));
  if (!check.ok) {
    await store.setImageHold(eventId, true);
    return { published: false, reason: NO_IMAGE };
  }
  await store.setVisibility(eventId, "published");
  await store.setImageHold(eventId, false);
  return { published: true, via: check.via };
}

/**
 * D-091: an event is published only with a picture to show. One rule for every path
 * (admin, collector, auto-publish gate, scheduled jobs, retry). Pure.
 */
import { safeHttpUrl } from "./http-url";

export const NO_IMAGE = "no_image" as const;
export const NO_IMAGE_MESSAGE = "Add a poster or a headliner photo first";

/** What an event has to show: its poster and its headliners' photos. */
export type EventVisual = {
  posterUrl: string | null;
  /** The headliner tier (or the top-billed act when no one is tiered headliner). */
  headliners: ReadonlyArray<{ imageUrl: string | null; altImageUrl: string | null }>;
};

export type VisualCheck =
  { ok: true; via: "poster" | "headliner_photo" } | { ok: false; reason: typeof NO_IMAGE };

/** A poster, or at least one headliner with a Spotify or alternative photo (http/https only). */
export function checkPublishVisual(visual: EventVisual | null): VisualCheck {
  if (visual && safeHttpUrl(visual.posterUrl ?? undefined)) return { ok: true, via: "poster" };
  const photo = visual?.headliners.some(
    (h) => safeHttpUrl(h.imageUrl ?? undefined) || safeHttpUrl(h.altImageUrl ?? undefined),
  );
  return photo ? { ok: true, via: "headliner_photo" } : { ok: false, reason: NO_IMAGE };
}

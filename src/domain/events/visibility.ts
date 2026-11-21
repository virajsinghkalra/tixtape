/**
 * Event visibility (D-056). Only `published` events reach users; new events start `held`
 * until verified, and past ones become `archived`. Mirrors the `event_visibility` enum.
 */
export const EVENT_VISIBILITIES = ["held", "published", "archived"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const PUBLIC_VISIBILITY: EventVisibility = "published";

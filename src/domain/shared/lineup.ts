/** Billing tiers on a lineup poster, highest first. */
export const BILLING_TIERS = ["headliner", "sub", "mid", "support"] as const;
export type BillingTier = (typeof BILLING_TIERS)[number];

export const EVENT_TYPES = ["concert", "festival"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ["announced", "partial_lineup", "full_lineup", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_SOURCES = [
  "admin",
  "ticketmaster",
  "jambase",
  "user_submission",
  "rollingstone",
  "pollstar",
  "wikipedia",
  "sunburn",
  "teaminnovation",
  "web",
  // D-073: gig coverage (HighApe listings, artist-first discovery).
  "highape",
  "artist_site",
  "gig_web",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const MATCH_STATUSES = ["pending", "auto", "needs_review", "manual", "not_found"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

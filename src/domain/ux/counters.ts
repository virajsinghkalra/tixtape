/**
 * D-084 (UX plan OD-4): the allow-list of aggregate UX metrics. Only these names are ever
 * stored, one count per IST day, so a hand-made request can't create arbitrary rows and nothing
 * personal can be smuggled in a metric name.
 */

export const UX_EVENTS = [
  "share_link",
  "share_story",
  "ics",
  "gcal",
  "save",
  "ping_me",
  "install_prompt_shown",
  "install_accepted",
  "push_optin",
  "spotify_open_app",
  "spotify_open_web",
  "og_hit",
  "view_via_wa",
  "view_via_ig",
  "view_via_copy",
  "view_via_native",
  "offline_view",
  "section_error",
] as const;
export type UxEvent = (typeof UX_EVENTS)[number];

export const VITALS = ["lcp", "inp", "cls"] as const;
export type Vital = (typeof VITALS)[number];
export type VitalRating = "good" | "ni" | "poor";
export type RouteGroup = "home" | "event" | "search" | "other";

/** web.dev thresholds: [good ≤, poor >]. CLS is unitless, the others are ms. */
const THRESHOLDS: Record<Vital, [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
};

export type UxMetric = UxEvent | `vitals:${RouteGroup}:${Vital}:${VitalRating}`;

export function isUxEvent(raw: unknown): raw is UxEvent {
  return typeof raw === "string" && (UX_EVENTS as readonly string[]).includes(raw);
}

export function rateVital(vital: Vital, value: number): VitalRating {
  const [good, poor] = THRESHOLDS[vital];
  if (value <= good) return "good";
  return value > poor ? "poor" : "ni";
}

/** Pages are grouped, never stored by path: an event path would identify the event. */
export function routeGroup(pathname: string): RouteGroup {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/events/")) return "event";
  if (pathname === "/search" || pathname.startsWith("/search/")) return "search";
  return "other";
}

export function vitalMetric(vital: Vital, value: number, pathname: string): UxMetric {
  return `vitals:${routeGroup(pathname)}:${vital}:${rateVital(vital, value)}`;
}

/** `?via=wa` on a shared link → `view_via_wa`; anything else isn't counted. */
export function viaMetric(via: string | null | undefined): UxEvent | null {
  const metric = `view_via_${via}`;
  return isUxEvent(metric) ? metric : null;
}

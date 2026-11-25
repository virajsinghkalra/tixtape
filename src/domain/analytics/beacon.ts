/**
 * D-090: the product-analytics beacon contract. Only the event names and prop keys listed here
 * are ever stored: every prop schema is strict and size-capped, so a hand-made request can't
 * smuggle anything else (an IP, a URL, free text) into `analytics_events`.
 */
import { z } from "zod";

/** Pages are grouped, never stored by path (an event path would identify the event twice). */
export const PATH_GROUPS = ["home", "event", "search", "privacy", "offline", "other"] as const;
export type PathGroup = (typeof PATH_GROUPS)[number];

export function pathGroup(pathname: string): PathGroup {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/events/")) return "event";
  if (pathname === "/search" || pathname.startsWith("/search/")) return "search";
  if (pathname === "/privacy") return "privacy";
  if (pathname === "/offline") return "offline";
  return "other";
}

export const SHARE_CHANNELS = ["native", "copy", "story", "whatsapp"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export const MAX_EVENTS_PER_BEACON = 20;
/** Bytes. A full beacon of 20 searches is about 3 KB. */
export const MAX_BEACON_BYTES = 8_192;
export const MAX_QUERY_CHARS = 100;

const eventId = z.uuid();
const artist = z.string().trim().min(1).max(100);
/** A city name as the switcher sends it ("all" = All India). Re-checked on the server. */
const city = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[\p{L}\p{M} .'-]+$/u);

/**
 * A search query, scrubbed: anything that looks like an email address or a phone number is
 * replaced, so a visitor who pastes one into the search box doesn't end up in our tables.
 */
export function scrubQuery(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_QUERY_CHARS)
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[number]");
}

const query = z.string().trim().min(1).max(MAX_QUERY_CHARS).transform(scrubQuery);
const none = z.strictObject({});

/** One allow-listed prop schema per event name. */
export const EVENT_PROPS = {
  page_view: z.strictObject({ path: z.enum(PATH_GROUPS) }),
  search: z.strictObject({ q: query, results: z.number().int().min(0).max(100_000) }),
  event_open: z.strictObject({ eventId }),
  playlist_make: z.strictObject({ eventId }),
  playlist_open_spotify: z.strictObject({ eventId: eventId.optional() }),
  share: z.strictObject({ channel: z.enum(SHARE_CHANNELS), eventId: eventId.optional() }),
  remind: z.strictObject({ eventId }),
  save: z.strictObject({ eventId }),
  ping_me: z.strictObject({ artist }),
  follow: z.strictObject({ artist }),
  city_change: z.strictObject({ city }),
  install: none,
  story_open: z.strictObject({ eventId: eventId.optional() }),
  ticket_click: z.strictObject({ eventId: eventId.optional() }),
  /** "Listen here": the in-page Spotify player opened. */
  playlist_preview: z.strictObject({ eventId: eventId.optional() }),
  /** How far down a page a visitor got (each mark once per page view). */
  scroll_depth: z.strictObject({
    path: z.enum(PATH_GROUPS),
    pct: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
  }),
  /** Seconds on a page before leaving it or hiding the tab (once per page view). */
  page_leave: z.strictObject({
    path: z.enum(PATH_GROUPS),
    secs: z.number().int().min(0).max(3_600),
  }),
} as const;

export type AnalyticsEventName = keyof typeof EVENT_PROPS;
export const ANALYTICS_EVENT_NAMES = Object.keys(EVENT_PROPS) as AnalyticsEventName[];
export type AnalyticsProps<N extends AnalyticsEventName> = z.input<(typeof EVENT_PROPS)[N]>;

export function isAnalyticsEventName(raw: unknown): raw is AnalyticsEventName {
  return typeof raw === "string" && Object.hasOwn(EVENT_PROPS, raw);
}

export type AnalyticsEvent = { n: AnalyticsEventName; p: Record<string, unknown> };

/** `{ n, p }`: the name must be allow-listed and `p` must match that name's strict schema. */
const EventSchema = z
  .strictObject({ n: z.enum(ANALYTICS_EVENT_NAMES), p: z.unknown().optional() })
  .transform((e, ctx): AnalyticsEvent => {
    const props = EVENT_PROPS[e.n].safeParse(e.p ?? {});
    if (!props.success) {
      ctx.addIssue({ code: "custom", message: `invalid props for ${e.n}` });
      return z.NEVER;
    }
    return { n: e.n, p: props.data };
  });

/** Where this visit came from, as the browser saw it on landing. Never a full URL. */
const SourceSchema = z.strictObject({
  /** utm_source / utm_medium / utm_campaign. */
  us: z.string().max(60).optional(),
  um: z.string().max(60).optional(),
  uc: z.string().max(80).optional(),
  /** The referrer's host name only. */
  ref: z.string().max(253).optional(),
  /** Our own `?via=` share tag. */
  via: z.string().max(12).optional(),
});
export type RawSource = z.infer<typeof SourceSchema>;

export const BeaconSchema = z.strictObject({
  /** The device ID: a random UUID kept in localStorage (`tixtape.did`). */
  did: z.uuid(),
  src: SourceSchema.optional(),
  ev: z.array(EventSchema).min(1).max(MAX_EVENTS_PER_BEACON),
});
export type Beacon = z.output<typeof BeaconSchema>;

/** Parses a beacon body (text, because `sendBeacon` posts text/plain). Null when invalid. */
export function parseBeacon(text: string): Beacon | null {
  if (text.length === 0 || new TextEncoder().encode(text).length > MAX_BEACON_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = BeaconSchema.safeParse(raw);
  return r.success ? r.data : null;
}

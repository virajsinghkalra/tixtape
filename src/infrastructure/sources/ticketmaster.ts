/**
 * Ticketmaster Discovery API v2 adapter (P1.6, LLD §5.1, D-008).
 * `GET /discovery/v2/events.json?classificationName=music&countryCode=…`, paged, paced to
 * at most 5 requests per second. Each event is validated on its own: a malformed one is
 * logged and skipped, while an HTTP failure or an unusable page fails the run.
 */
import { z } from "zod";
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import type { Clock } from "@/application/ports/clock";
import { safeHttpUrl } from "@/domain/events/http-url";
import { tierFromAttractionOrder } from "@/domain/events/lineup";
import { RawEventSchema, type RawEvent } from "@/domain/events/raw-event";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";

const UPSTREAM = "ticketmaster";
export const TICKETMASTER_BASE_URL = "https://app.ticketmaster.com";
/** 5 req/s. */
const MIN_REQUEST_INTERVAL_MS = 200;
const MAX_PAGE_SIZE = 200;
/** D-070: never wait on Ticketmaster for more than 10 seconds per page. */
const TIMEOUT_MS = 10_000;
/** The Discovery API refuses to page past the 1000th result (`size × page < 1000`). */
const MAX_DEEP_RESULTS = 1000;
/** At or above this many acts a bill is a festival even without "fest" in the name. */
const FESTIVAL_MIN_ACTS = 6;

export type TicketmasterDeps = {
  apiKey: string;
  /** ISO 3166-1 alpha-2 codes, queried one after another, e.g. ["IN"]. */
  countryCodes: readonly string[];
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  /** `debug` is optional: skipped non-music events are only worth a debug line. */
  logger: Pick<Logger, "warn"> & Partial<Pick<Logger, "debug">>;
  /** Live lookup (D-050): only events matching this keyword. */
  keyword?: string;
  /** ≤ 200. */
  pageSize?: number;
  baseUrl?: string;
};

// ── Response schemas (only the fields we use) ─────────────────────────────

const PageSchema = z.object({
  _embedded: z.object({ events: z.array(z.unknown()) }).optional(),
  page: z.object({
    size: z.number().int(),
    totalElements: z.number().int(),
    totalPages: z.number().int(),
    number: z.number().int(),
  }),
});

const DateSchema = z.object({
  localDate: z.iso.date().optional(),
  localTime: z.iso.time().optional(),
  dateTime: z.iso.datetime().optional(),
  timeTBA: z.boolean().optional(),
  noSpecificTime: z.boolean().optional(),
});

const VenueSchema = z.object({
  name: z.string().trim().min(1),
  city: z.object({ name: z.string().trim().min(1) }),
  state: z.object({ name: z.string().optional(), stateCode: z.string().optional() }).optional(),
  country: z.object({ countryCode: z.string().regex(/^[A-Za-z]{2}$/u) }),
  timezone: z.string().optional(),
  location: z.object({ latitude: z.string(), longitude: z.string() }).optional(),
});

const EventSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  // Checked with `safeHttpUrl` when mapping: a bad link drops the link, not the event.
  url: z.string().optional(),
  dates: z.object({
    start: DateSchema,
    end: DateSchema.optional(),
    timezone: z.string().optional(),
    status: z.object({ code: z.string() }).optional(),
    spanMultipleDays: z.boolean().optional(),
  }),
  classifications: z
    .array(
      z.object({
        segment: z.object({ name: z.string() }).optional(),
        genre: z.object({ name: z.string() }).optional(),
      }),
    )
    .optional(),
  images: z
    .array(
      z.object({ url: z.string(), width: z.number().optional(), ratio: z.string().optional() }),
    )
    .optional(),
  _embedded: z
    .object({
      venues: z.array(VenueSchema).min(1),
      attractions: z.array(z.object({ name: z.string().optional() })).optional(),
    })
    .optional(),
});
type TmEvent = z.infer<typeof EventSchema>;

// ── Adapter ───────────────────────────────────────────────────────────────

export class TicketmasterSource implements SourceAdapter {
  readonly source = "ticketmaster" as const;
  private lastRequestAt: number | null = null;
  private readonly pageSize: number;

  constructor(private readonly deps: TicketmasterDeps) {
    this.pageSize = Math.min(deps.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  }

  async *fetch(opts: SourceFetchOptions): AsyncIterable<RawEvent> {
    for (const countryCode of this.deps.countryCodes) {
      yield* this.fetchCountry(countryCode, opts);
    }
  }

  private async *fetchCountry(countryCode: string, opts: SourceFetchOptions) {
    for (let page = 0; ; page++) {
      const body = await this.getPage(countryCode, opts, page);
      for (const item of body._embedded?.events ?? []) {
        const event = this.toRawEvent(item);
        if (event) yield event;
      }
      if (page + 1 >= body.page.totalPages) return;
      if ((page + 2) * this.pageSize > MAX_DEEP_RESULTS) {
        this.deps.logger.warn(
          { source: UPSTREAM, countryCode, totalElements: body.page.totalElements },
          "ticketmaster: result window capped at 1000 events; narrow the date range",
        );
        return;
      }
    }
  }

  private async getPage(countryCode: string, opts: SourceFetchOptions, page: number) {
    const url = new URL("/discovery/v2/events.json", this.deps.baseUrl ?? TICKETMASTER_BASE_URL);
    url.searchParams.set("apikey", this.deps.apiKey);
    url.searchParams.set("classificationName", "music");
    url.searchParams.set("countryCode", countryCode);
    if (this.deps.keyword) url.searchParams.set("keyword", this.deps.keyword);
    url.searchParams.set("startDateTime", tmDateTime(opts.from));
    if (opts.to) url.searchParams.set("endDateTime", tmDateTime(opts.to));
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("size", String(this.pageSize));
    url.searchParams.set("page", String(page));

    await this.pace();
    // The URL carries the API key, so it never goes into errors or logs.
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(UPSTREAM, "Ticketmaster could not be reached.", { cause: e });
    }
    if (!res.ok) {
      throw new UpstreamError(
        UPSTREAM,
        `Ticketmaster returned HTTP ${res.status} for page ${page}.`,
      );
    }
    const parsed = PageSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) {
      throw new UpstreamError(UPSTREAM, `Ticketmaster page ${page} had an unexpected shape.`);
    }
    return parsed.data;
  }

  private async pace(): Promise<void> {
    if (this.lastRequestAt !== null) {
      const wait = this.lastRequestAt + MIN_REQUEST_INTERVAL_MS - this.deps.clock.now().getTime();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.lastRequestAt = this.deps.clock.now().getTime();
  }

  private toRawEvent(item: unknown): RawEvent | null {
    const parsed = EventSchema.safeParse(item);
    if (!parsed.success) return this.skip(item, parsed.error.issues[0]?.message ?? "invalid");
    if (!isMusic(parsed.data)) {
      this.deps.logger.debug?.(
        { source: UPSTREAM, externalId: parsed.data.id },
        "ticketmaster: skipped non-music event",
      );
      return null;
    }
    const mapped = mapEvent(parsed.data);
    if (typeof mapped === "string") return this.skip(item, mapped);
    const valid = RawEventSchema.safeParse(mapped);
    if (!valid.success) return this.skip(item, valid.error.issues[0]?.message ?? "invalid");
    return valid.data;
  }

  private skip(item: unknown, reason: string): null {
    const id = typeof item === "object" && item !== null && "id" in item ? item.id : undefined;
    this.deps.logger.warn(
      { source: UPSTREAM, externalId: id, reason },
      "ticketmaster: skipped malformed event",
    );
    return null;
  }
}

/** Maps a validated Ticketmaster event, or returns why it can't be used. */
function mapEvent(e: TmEvent): RawEvent | string {
  const venue = e._embedded?.venues[0];
  if (!venue) return "no venue";
  const timeZone = venueTimeZone(e, venue);
  const startsAtDateOnly = isDateOnly(e.dates.start);
  const startsAt = toInstant(e.dates.start, timeZone);
  if (!startsAt) return "no start date";
  const acts = (e._embedded?.attractions ?? []).flatMap((a) =>
    a.name?.trim() ? [a.name.trim()] : [],
  );
  const genre = e.classifications?.[0]?.genre?.name;
  return {
    source: "ticketmaster",
    externalId: e.id,
    url: safeHttpUrl(e.url),
    title: e.name,
    type: isFestival(e, acts.length) ? "festival" : "concert",
    startsAt,
    startsAtDateOnly,
    endsAt: e.dates.end ? toInstant(e.dates.end, timeZone) : undefined,
    status: e.dates.status?.code === "cancelled" ? "cancelled" : "announced",
    genre: genre && genre !== "Undefined" ? genre : undefined,
    imageUrl: pickImage(e.images ?? []),
    venue: {
      name: venue.name,
      city: venue.city.name,
      state: venue.state?.stateCode ?? venue.state?.name,
      country: venue.country.countryCode,
      ...coordinates(venue.location),
    },
    lineup: acts.map((name, i) => ({
      name,
      billingRank: i + 1,
      tier: tierFromAttractionOrder(i, acts.length),
    })),
    raw: e,
  };
}

/**
 * LLD §5.1: music only. The query already asks for `classificationName=music`, but the API
 * can still return other segments. An event with no segment at all is kept.
 */
function isMusic(e: TmEvent): boolean {
  const segments = (e.classifications ?? []).flatMap((c) => (c.segment ? [c.segment.name] : []));
  return segments.length === 0 || segments.some((name) => name.toLowerCase() === "music");
}

/**
 * The venue's zone, else the event's, else the country default (Asia/Kolkata for IN), else UTC.
 * Used for events without a UTC `dateTime`.
 */
function venueTimeZone(e: TmEvent, venue: z.infer<typeof VenueSchema>): string {
  const countryDefault = venue.country.countryCode.toUpperCase() === "IN" ? "Asia/Kolkata" : "UTC";
  return venue.timezone ?? e.dates.timezone ?? countryDefault;
}

/** A multi-day event, "fest"/"festival" in the name, or a long bill. */
function isFestival(e: TmEvent, actCount: number): boolean {
  return (
    e.dates.spanMultipleDays === true ||
    /\bfest(ival)?\b/iu.test(e.name) ||
    actCount >= FESTIVAL_MIN_ACTS
  );
}

/** D-034: no time given, or Ticketmaster says the time is TBA / unspecified. */
function isDateOnly(d: z.infer<typeof DateSchema>): boolean {
  if (d.timeTBA === true || d.noSpecificTime === true)
    return d.localDate !== undefined || !!d.dateTime;
  return !d.dateTime && !d.localTime && d.localDate !== undefined;
}

/**
 * Prefer the UTC `dateTime`; otherwise read `localDate`/`localTime` in `timeZone`.
 * A date-only start is 00:00 local on `localDate` (D-034), even if a placeholder `dateTime` exists.
 */
function toInstant(d: z.infer<typeof DateSchema>, timeZone: string): Date | undefined {
  if (isDateOnly(d) && d.localDate) return zonedToUtc(d.localDate, "00:00:00", timeZone);
  if (d.dateTime) return new Date(d.dateTime);
  if (!d.localDate) return undefined;
  return zonedToUtc(d.localDate, d.localTime ?? "00:00:00", timeZone);
}

function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const asUtc = new Date(`${date}T${time}Z`);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(asUtc);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return new Date(asUtc.getTime() - (wall - asUtc.getTime()));
  } catch {
    return asUtc; // Unknown time zone: UTC keeps the date right for dedupe.
  }
}

/** Widest 16:9 image, else the widest of any ratio. */
function pickImage(images: { url: string; width?: number; ratio?: string }[]): string | undefined {
  const byWidth = (a: { width?: number }, b: { width?: number }) => (b.width ?? 0) - (a.width ?? 0);
  const usable = images.filter((i) => safeHttpUrl(i.url) !== undefined);
  const wide = usable.filter((i) => i.ratio === "16_9").sort(byWidth);
  return (wide[0] ?? [...usable].sort(byWidth)[0])?.url;
}

function coordinates(location: { latitude: string; longitude: string } | undefined) {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!location || !Number.isFinite(lat) || !Number.isFinite(lng)) return {};
  return { lat, lng };
}

/** Ticketmaster wants `YYYY-MM-DDTHH:mm:ssZ`, without milliseconds. */
function tmDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

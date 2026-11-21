/**
 * Sunburn (D-033): the organiser's own site, official for event, date and venue.
 * - The Events Calendar REST API (`/wp-json/tribe/events/v1/events`): every upcoming show with
 *   explicit dates, venue and category. Single-city shows become candidates; the act comes
 *   from the title ("Sunburn Arena ft. DJ Snake – Bangalore", "Anyma Presents Aeden – Mumbai").
 *   Multi-city tours and shows without a city are skipped.
 * - WordPress posts (`/wp-json/wp/v2/posts`): announcements, read like articles.
 * The festival lineup itself is published only as an image (checked 2026-11-21: no text
 * lineup on the event page, API or posts), so lineup names come from image file names when
 * they carry any, and otherwise from corroborating outlets.
 */
import { z } from "zod";
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import {
  actFromEventTitle,
  CANCELLED,
  extractArticleCandidate,
} from "@/domain/events/extract/article";
import {
  SOURCE_TRUST,
  type ArtistMention,
  type EventCandidate,
} from "@/domain/events/extract/candidate";
import { findCity, findVenue } from "@/domain/events/extract/places";
import { istDay } from "@/domain/events/ist-calendar";
import { htmlToText } from "@/domain/events/extract/html";
import { artistsFromImageName } from "@/domain/events/extract/image-names";
import { httpUrl } from "@/domain/events/http-url";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import type { PoliteFetcher } from "./polite-fetch";

export const SUNBURN_EVENTS_URL = "https://sunburn.in/wp-json/tribe/events/v1/events";
export const SUNBURN_POSTS_URL =
  "https://sunburn.in/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,content";

const PostSchema = z.object({
  id: z.number().int().positive(),
  /** WordPress site-local time (IST), without an offset. */
  date: z.iso.datetime({ local: true }).optional(),
  link: httpUrl(),
  title: z.object({ rendered: z.string() }),
  content: z.object({ rendered: z.string() }),
});

const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
const TribeEventSchema = z.object({
  id: z.number().int().positive(),
  url: httpUrl(),
  title: z.string().min(1),
  status: z.string().optional(),
  start_date: LocalDateTime,
  end_date: LocalDateTime,
  categories: z.array(z.object({ name: z.string() })).default([]),
  // An event without a venue has `venue: []`.
  venue: z
    .union([
      z.object({ venue: z.string().nullish(), city: z.string().nullish() }),
      z.array(z.unknown()),
    ])
    .optional(),
});
const TribePageSchema = z.object({ events: z.array(z.unknown()) });

/** "2026-12-18 16:00:00" (site time, IST) → 00:00 IST that day. */
function istDate(local: string): Date {
  return new Date(`${local.slice(0, 10)}T00:00:00+05:30`);
}

/** The act a show title names: "… ft. DJ Snake – Bangalore", "Anyma Presents Aeden – Mumbai". */
export function actFromShowTitle(title: string): ArtistMention | null {
  const ft = /\b(?:ft\.?|feat\.?|featuring)\s+(.+?)(?:\s+[–—-]\s+.*)?$/iu.exec(title);
  if (ft?.[1]) return { name: ft[1].trim(), parts: [] };
  const presents = /^(.+?)\s+presents\b/iu.exec(title);
  if (presents?.[1]) return { name: presents[1].trim(), parts: [] };
  return actFromEventTitle(title);
}

/** One official show from the Events Calendar, or null when it has no single city. */
export function tribeEventCandidate(raw: unknown, now: Date): EventCandidate | null {
  const parsed = TribeEventSchema.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  const title = htmlToText(e.title);
  const venue = e.venue && !Array.isArray(e.venue) ? e.venue : {};
  const city =
    (venue.city ? findCity(venue.city) : null) ??
    (venue.venue ? findCity(venue.venue) : null) ??
    findCity(title);
  if (!city) return null;
  const startsAt = istDate(e.start_date);
  const endDay = istDate(e.end_date);
  const endsAt = endDay.getTime() > startsAt.getTime() ? endDay : null;
  if ((endsAt ?? startsAt).getTime() < now.getTime() - 86_400_000) return null;
  const known = venue.venue ? findVenue(`at ${venue.venue}`) : null;
  const venueName =
    known?.city === city
      ? known.name
      : venue.venue && !findCity(venue.venue.replace(/,.*$/u, "")) && !/^india$/iu.test(venue.venue)
        ? venue.venue.replace(/,\s*[^,]+$/u, "").trim()
        : null;
  const festival = e.categories.some((c) => /festival/iu.test(c.name));
  const act = festival ? null : actFromShowTitle(title);
  return {
    source: "sunburn",
    trust: SOURCE_TRUST.sunburn,
    externalId: `event:${e.id}`,
    url: e.url,
    title,
    type: festival ? "festival" : "concert",
    startsAt,
    endsAt,
    dateExplicit: true,
    city,
    country: "IN",
    venueName,
    artists: act ? [act] : [],
    confidence: 0.9,
    fingerprint: e.url,
    ...(CANCELLED.test(title) || (e.status !== undefined && e.status !== "publish")
      ? { cancelled: true }
      : {}),
  };
}

export type SunburnDeps = { fetcher: PoliteFetcher; logger: Pick<Logger, "warn"> };

export class SunburnSource implements CandidateSource {
  readonly source = "sunburn" as const;

  constructor(private readonly deps: SunburnDeps) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    yield* await this.events(opts.now);
    yield* this.posts(opts);
  }

  private async events(now: Date): Promise<EventCandidate[]> {
    const url = new URL(SUNBURN_EVENTS_URL);
    const day = istDay(now);
    url.search = new URLSearchParams({
      per_page: "50",
      start_date: `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`,
    }).toString();
    let body: unknown;
    try {
      body = JSON.parse(await this.deps.fetcher.getText(url.href, { accept: "application/json" }));
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError(this.source, "Sunburn events did not return JSON.");
    }
    const page = TribePageSchema.safeParse(body);
    if (!page.success)
      throw new UpstreamError(this.source, "Sunburn events had an unexpected shape.");
    const out: EventCandidate[] = [];
    for (const item of page.data.events) {
      if (!TribeEventSchema.safeParse(item).success) {
        this.deps.logger.warn({ source: this.source }, "sunburn: skipped malformed event");
        continue;
      }
      const c = tribeEventCandidate(item, now);
      if (c) out.push(c);
    }
    return out;
  }

  private async *posts(opts: CollectOptions): AsyncIterable<EventCandidate> {
    const text = await this.deps.fetcher.getText(SUNBURN_POSTS_URL, { accept: "application/json" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new UpstreamError(this.source, "Sunburn did not return JSON.");
    }
    if (!Array.isArray(body))
      throw new UpstreamError(this.source, "Sunburn posts were not a list.");
    for (const item of body) {
      const post = PostSchema.safeParse(item);
      if (!post.success) {
        this.deps.logger.warn(
          { source: this.source, reason: post.error.issues[0]?.message },
          "sunburn: skipped malformed post",
        );
        continue;
      }
      const html = post.data.content.rendered;
      const candidate = extractArticleCandidate(
        {
          source: this.source,
          trust: SOURCE_TRUST.sunburn,
          externalId: `post:${post.data.id}`,
          url: post.data.link,
          title: htmlToText(post.data.title.rendered),
          text: htmlToText(html),
          watchTerms: opts.watchTerms,
          publishedAt: post.data.date ? new Date(`${post.data.date}+05:30`) : undefined,
        },
        opts.now,
      );
      if (!candidate) continue;
      const fromImages = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/giu)].flatMap((m) =>
        artistsFromImageName(m[1] ?? ""),
      );
      yield { ...candidate, artists: [...candidate.artists, ...fromImages] };
    }
  }
}

/**
 * Team Innovation (D-033): a promoter whose "Upcoming Shows" page is static HTML cards with
 * the show name, place and date. Official for event and date. Multi-city tours ("India Tour ·
 * 9 Cities") have no single city on the card and are skipped.
 */
import { z } from "zod";
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import {
  actFromEventTitle,
  CANCELLED,
  extractArtistMentions,
} from "@/domain/events/extract/article";
import {
  SOURCE_TRUST,
  type ArtistMention,
  type EventCandidate,
} from "@/domain/events/extract/candidate";
import { parseDateRange } from "@/domain/events/extract/dates";
import { htmlToText } from "@/domain/events/extract/html";
import { findCity, findVenue } from "@/domain/events/extract/places";
import { httpUrl } from "@/domain/events/http-url";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import type { PoliteFetcher } from "./polite-fetch";

export const TEAM_INNOVATION_URL = "https://teaminnovation.in/upcoming-events.html";

const CardSchema = z.object({
  title: z.string().trim().min(1).max(300),
  place: z.string().trim().min(1).max(200),
  date: z.string().trim().min(1).max(200),
  url: httpUrl(),
});
type Card = z.infer<typeof CardSchema>;

const inner = (html: string, tag: string) =>
  new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "iu").exec(html)?.[1];

/** The cards on the page, validated. Throws when the page has no cards at all. */
export function parseTeamInnovationCards(
  html: string,
  pageUrl: string,
): { cards: Card[]; skipped: number } {
  const blocks = html.split(/<div class="upcards">/u).slice(1);
  if (blocks.length === 0) {
    throw new UpstreamError("teaminnovation", "Team Innovation's page had no show cards.");
  }
  const cards: Card[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const href = /<a\b[^>]*href="([^"]+)"[^>]*>\s*View Details/iu.exec(block)?.[1];
    const parsed = CardSchema.safeParse({
      title: htmlToText(inner(block, "h2") ?? ""),
      place: htmlToText(inner(block, "h6") ?? ""),
      date: htmlToText(inner(block, "p") ?? ""),
      url: href ? new URL(href, pageUrl).href : undefined,
    });
    if (parsed.success) cards.push(parsed.data);
    else skipped++;
  }
  return { cards, skipped };
}

/** "Charlie Puth – Johnnie & Co. Music Festival" → event "Johnnie & Co. Music Festival", act "Charlie Puth". */
function splitTitle(title: string): { event: string; act: string | null } {
  const m = /^(.+?)\s+[–—-]\s+(.+)$/u.exec(title);
  if (m?.[1] && m[2] && /\b(festival|fest|weekender|tour|live|concert)\b/iu.test(m[2])) {
    return { event: m[2], act: m[1] };
  }
  return { event: title, act: null };
}

export type TeamInnovationDeps = { fetcher: PoliteFetcher; logger: Pick<Logger, "warn"> };

export class TeamInnovationSource implements CandidateSource {
  readonly source = "teaminnovation" as const;

  constructor(private readonly deps: TeamInnovationDeps) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    const html = await this.deps.fetcher.getText(TEAM_INNOVATION_URL, { accept: "text/html" });
    const { cards, skipped } = parseTeamInnovationCards(html, TEAM_INNOVATION_URL);
    if (skipped > 0) {
      this.deps.logger.warn(
        { source: this.source, skipped },
        "teaminnovation: skipped malformed cards",
      );
    }
    const home = new URL(TEAM_INNOVATION_URL).host;
    for (const card of cards) {
      // D-070: links leave the site only to be skipped (no fetching other hosts from a card).
      if (new URL(card.url).host !== home) {
        this.deps.logger.warn(
          { source: this.source, url: card.url },
          "teaminnovation: skipped a card linking to another host",
        );
        continue;
      }
      const city = findCity(card.place);
      const range = parseDateRange(card.date, opts.now);
      if (!city || !range) continue;
      if ((range.end ?? range.start).getTime() < opts.now.getTime() - 86_400_000) continue;
      const { event, act } = splitTitle(card.title);
      // "Charlie Puth – …Festival" names the act; "X Live in Mumbai" / "X India Tour" implies it.
      const headliner = act ? { name: act, parts: [] } : actFromEventTitle(card.title);
      const detail = await this.detail(card.url, opts.now);
      const venue = findVenue(card.place) ?? detail.venue;
      const artists = [...(headliner ? [headliner] : []), ...detail.artists];
      yield {
        source: this.source,
        trust: SOURCE_TRUST.teaminnovation,
        externalId: new URL(card.url).pathname.replace(/^\/|\.html$/gu, ""),
        url: card.url,
        title: event,
        type: /\b(festival|fest|weekender)\b/iu.test(event) ? "festival" : "concert",
        startsAt: range.start,
        endsAt: range.end,
        dateExplicit: range.yearGiven,
        fingerprint: card.url,
        city,
        country: "IN",
        venueName: venue?.city === city ? venue.name : null,
        artists,
        confidence: range.yearGiven ? 0.9 : 0.7,
        ...(CANCELLED.test(card.title) || detail.cancelled ? { cancelled: true } : {}),
      };
    }
  }

  /**
   * The show's own page: venue ("Mahalaxmi Racecourse, Mumbai") and the lineup sentence
   * ("…Ellie Goulding, alongside an exciting lineup featuring GINI, KAYAN, MALI and Taba Chake").
   * A failed page only loses these extras; the card still counts.
   */
  private async detail(
    url: string,
    now: Date,
  ): Promise<{
    venue: { name: string; city: string } | null;
    artists: ArtistMention[];
    cancelled: boolean;
  }> {
    try {
      const html = await this.deps.fetcher.getText(url, { accept: "text/html" });
      const main = /<main\b[\s\S]*?<\/main>/iu.exec(html)?.[0] ?? html;
      const body = main.replace(/<footer\b[\s\S]*?<\/footer>/giu, "");
      const text = htmlToText(body);
      return {
        venue: findVenue(text),
        artists: extractArtistMentions(text, now),
        cancelled: /\b(this (show|event) (has been|is) (cancell?ed|postponed))\b/iu.test(text),
      };
    } catch (e) {
      this.deps.logger.warn(
        { source: this.source, url, err: e },
        "teaminnovation: detail page failed",
      );
      return { venue: null, artists: [], cancelled: false };
    }
  }
}

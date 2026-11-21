/**
 * Rolling Stone India (D-033): a trusted outlet with full article text in RSS
 * `content:encoded`. robots.txt sets Crawl-delay: 600, so a run reads exactly one feed URL and
 * never article pages. Runs alternate between the main feed and one festival tag feed; tag
 * slots go first to series whose stored events still lack a confirmed lineup (`focus`).
 * Tag URLs were checked by hand (`/tag/sunburn/feed/` verified 2026-11-21).
 */
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import { eventNameTokens } from "@/domain/events/dedupe";
import { extractArticleCandidate } from "@/domain/events/extract/article";
import { SOURCE_TRUST, type EventCandidate } from "@/domain/events/extract/candidate";
import type { Logger } from "@/lib/logger";
import type { PoliteFetcher } from "./polite-fetch";
import { parseRss, toArticle } from "./rss";

export const ROLLING_STONE_FEED = "https://rollingstoneindia.com/feed/";
/** Series (folded name without years) → Rolling Stone India tag slug. */
const SERIES_TAGS: Readonly<Record<string, string>> = {
  sunburn: "sunburn",
  "sunburn festival": "sunburn",
  "lollapalooza india": "lollapalooza-india",
  "nh7 weekender": "nh7-weekender",
  "magnetic fields": "magnetic-fields",
  "ziro festival of music": "ziro-festival-of-music",
};
const tagFeed = (slug: string) => `https://rollingstoneindia.com/tag/${slug}/feed/`;
export const ROLLING_STONE_TAG_FEEDS: readonly string[] = [
  ...new Set(Object.values(SERIES_TAGS)),
].map(tagFeed);
/** The schedule runs every 3 hours (D-050); each slot reads one feed. */
const SLOT_MS = 3 * 3_600_000;

/** The tag feed for an event title's series, if we know one ("Sunburn Festival 2026" → sunburn). */
export function seriesTagFeed(title: string): string | null {
  const key = eventNameTokens(title).join(" ");
  const slug = SERIES_TAGS[key];
  return slug ? tagFeed(slug) : null;
}

/**
 * Even slots read the main feed; odd slots read a tag feed: the series in `focus` (events
 * still missing a lineup) in turn, else every known tag in turn. One URL per run either way.
 */
export function rollingStoneFeedFor(now: Date, focus: readonly string[] = []): string {
  const slot = Math.floor(now.getTime() / SLOT_MS);
  if (slot % 2 === 0) return ROLLING_STONE_FEED;
  const focused = [...new Set(focus.map(seriesTagFeed).filter((u): u is string => u !== null))];
  const tags = focused.length > 0 ? focused : ROLLING_STONE_TAG_FEEDS;
  return tags[Math.floor(slot / 2) % tags.length]!;
}

export type NewsSourceDeps = {
  fetcher: PoliteFetcher;
  logger: Pick<Logger, "warn">;
};

/** An operator's pick for this run: a known tag slug ("sunburn"), never an arbitrary URL. */
export function knownFeed(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const url = tag === "main" ? ROLLING_STONE_FEED : tagFeed(tag);
  if (url !== ROLLING_STONE_FEED && !ROLLING_STONE_TAG_FEEDS.includes(url)) {
    throw new Error(
      `Unknown Rolling Stone India feed "${tag}". Use main or one of the known tags.`,
    );
  }
  return url;
}

export class RollingStoneIndiaSource implements CandidateSource {
  readonly source = "rollingstone" as const;

  constructor(private readonly deps: NewsSourceDeps & { feed?: string }) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    const url = knownFeed(this.deps.feed) ?? rollingStoneFeedFor(opts.now, opts.focus);
    const xml = await this.deps.fetcher.getText(url, {
      accept: "application/rss+xml, application/xml",
    });
    const { items, skipped } = parseRss(xml, this.source);
    for (const s of skipped) {
      this.deps.logger.warn(
        { source: this.source, url, ...s },
        "rollingstone: skipped malformed item",
      );
    }
    for (const item of items) {
      const article = toArticle(item, {
        source: this.source,
        trust: SOURCE_TRUST.rollingstone,
        watchTerms: opts.watchTerms,
      });
      const candidate = extractArticleCandidate(article, opts.now);
      if (candidate) yield candidate;
    }
  }
}

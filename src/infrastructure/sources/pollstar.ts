/**
 * Pollstar news (D-033): a trusted outlet whose RSS carries full text. It covers the world,
 * so only items about India (the country or an Indian city we know) are read.
 * robots.txt sets Crawl-delay: 10, which the fetcher honours.
 */
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import { extractArticleCandidate, isIndiaRelated } from "@/domain/events/extract/article";
import { SOURCE_TRUST, type EventCandidate } from "@/domain/events/extract/candidate";
import type { NewsSourceDeps } from "./rollingstone";
import { parseRss, toArticle } from "./rss";

export const POLLSTAR_FEED = "https://news.pollstar.com/feed/";

export class PollstarSource implements CandidateSource {
  readonly source = "pollstar" as const;

  constructor(private readonly deps: NewsSourceDeps) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    const xml = await this.deps.fetcher.getText(POLLSTAR_FEED, {
      accept: "application/rss+xml, application/xml",
    });
    const { items, skipped } = parseRss(xml, this.source);
    for (const s of skipped) {
      this.deps.logger.warn({ source: this.source, ...s }, "pollstar: skipped malformed item");
    }
    for (const item of items) {
      const article = toArticle(item, {
        source: this.source,
        trust: SOURCE_TRUST.pollstar,
        watchTerms: opts.watchTerms,
      });
      if (!isIndiaRelated(`${article.title}\n${article.text}`)) continue;
      const candidate = extractArticleCandidate(article, opts.now);
      if (candidate) yield candidate;
    }
  }
}

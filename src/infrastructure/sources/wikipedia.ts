/**
 * Wikipedia via the MediaWiki API (D-033): edition facts for a few Indian festivals, read
 * from `action=parse&prop=wikitext`. Content is CC BY-SA, so every candidate keeps the page
 * URL. The API is used under its own etiquette (descriptive User-Agent, serial requests),
 * which is why robots.txt's /w/ rule for crawlers isn't applied here.
 */
import { z } from "zod";
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import { SOURCE_TRUST, type EventCandidate } from "@/domain/events/extract/candidate";
import {
  extractWikipediaEditions,
  type WikiFestival,
  type WikiPage,
} from "@/domain/events/extract/wikitext";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import type { PoliteFetcher } from "./polite-fetch";

export const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

export type WikiTarget = WikiFestival & { page: string };

/** Pages checked on every scheduled run. */
export const WIKIPEDIA_FESTIVALS: readonly WikiTarget[] = [
  { page: "NH7 Weekender", eventName: "NH7 Weekender" },
  { page: "Sunburn Festival", eventName: "Sunburn Festival" },
  { page: "Ziro Festival of Music", eventName: "Ziro Festival of Music" },
  // Magnetic Fields has no English Wikipedia page yet (checked 2026-11-21).
];
/** Watch-list searches per scheduled run (D-050), to keep a run short. */
const MAX_WATCH_SEARCHES = 5;

const ParseSchema = z.union([
  z.object({
    parse: z.object({ title: z.string().min(1), pageid: z.number().int(), wikitext: z.string() }),
  }),
  z.object({ error: z.object({ code: z.string(), info: z.string().optional() }) }),
]);

const SearchSchema = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string().min(1), pageid: z.number().int() })),
  }),
});

const TOUR_OR_FESTIVAL = /\b(tour|festival|fest|weekender|concert|live)\b/iu;

export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /gu, "_"))}`;
}

export type WikipediaDeps = {
  fetcher: PoliteFetcher;
  logger: Pick<Logger, "warn">;
  festivals?: readonly WikiTarget[];
};

export class WikipediaSource implements CandidateSource {
  readonly source = "wikipedia" as const;

  constructor(private readonly deps: WikipediaDeps) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    for (const target of this.deps.festivals ?? WIKIPEDIA_FESTIVALS) {
      yield* await this.editions(target, opts.now);
    }
    // A failed watch-list search (e.g. HTTP 429) skips that term, not the festival pages.
    for (const term of (opts.watchTerms ?? []).slice(0, MAX_WATCH_SEARCHES)) {
      try {
        yield* await this.lookUp(term, opts.now);
      } catch (e) {
        this.deps.logger.warn(
          { err: e, source: this.source, term },
          "wikipedia: watch-list search failed",
        );
      }
    }
  }

  /**
   * Live lookup (D-050): search for the term and parse the best tour or festival page under
   * the same strict rules (D-054/055). The headliner comes from the page, never the query.
   */
  async lookUp(term: string, now: Date): Promise<EventCandidate[]> {
    const hits = await this.search(`${term} concert tour festival`);
    const best = hits.find((h) => TOUR_OR_FESTIVAL.test(h.title));
    if (!best) return [];
    return this.editions(
      { page: best.title, eventName: best.title.replace(/\s*\([^)]*\)\s*$/u, "") },
      now,
    );
  }

  private async editions(target: WikiTarget, now: Date): Promise<EventCandidate[]> {
    const page = await this.page(target.page);
    if (!page) return [];
    const url = wikipediaUrl(page.title);
    return extractWikipediaEditions(page, target, now).map((c) => ({
      ...c,
      source: this.source,
      trust: SOURCE_TRUST.wikipedia,
      url,
    }));
  }

  private async page(title: string): Promise<WikiPage | null> {
    const url = new URL(WIKIPEDIA_API);
    url.search = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "wikitext",
      redirects: "1",
      format: "json",
      formatversion: "2",
    }).toString();
    const parsed = ParseSchema.safeParse(await this.getJson(url));
    if (!parsed.success) {
      throw new UpstreamError(this.source, `Wikipedia returned an unexpected shape for ${title}.`);
    }
    if ("error" in parsed.data) {
      this.deps.logger.warn(
        { source: this.source, page: title, code: parsed.data.error.code },
        "wikipedia: page not available",
      );
      return null;
    }
    const p = parsed.data.parse;
    return { pageId: p.pageid, title: p.title, wikitext: p.wikitext };
  }

  private async search(query: string): Promise<{ title: string; pageid: number }[]> {
    const url = new URL(WIKIPEDIA_API);
    url.search = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "5",
      format: "json",
      formatversion: "2",
    }).toString();
    const parsed = SearchSchema.safeParse(await this.getJson(url));
    if (!parsed.success) {
      throw new UpstreamError(this.source, "Wikipedia search returned an unexpected shape.");
    }
    return parsed.data.query.search;
  }

  private async getJson(url: URL): Promise<unknown> {
    const text = await this.deps.fetcher.getText(url.href, {
      accept: "application/json",
      policy: "api-etiquette",
    });
    try {
      return JSON.parse(text);
    } catch {
      throw new UpstreamError(this.source, "Wikipedia did not return JSON.");
    }
  }
}

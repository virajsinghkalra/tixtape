/**
 * HighApe (D-073, docs/research/gig-sources.md): club nights and gigs in five Indian cities.
 * Each city page carries a schema.org `ItemList` of `Event` JSON-LD. robots.txt allows city
 * pages (only `/api/`, `/account/`, `/ticket/` are blocked) and the terms have no clause on
 * automated access. HighApe sells the tickets itself, so for the auto-publish gate (D-074) a
 * listing is a primary ticketing page. For the D-056 layers it is only `trusted`: anyone can
 * list there and acts come from free-text titles, so one listing never verifies an event.
 * Its `addressLocality` is unreliable (Mumbai events tagged "Bangalore"), so the city is the
 * one the event's own name or venue states, else the city page's own heading.
 * Acts come from the title ("… Ft X", "X Live at …"); only Spotify-confirmed names survive.
 */
import type { CandidateSource, CollectOptions } from "@/application/ingestion/ports";
import { SOURCE_TRUST, type EventCandidate } from "@/domain/events/extract/candidate";
import { findCity } from "@/domain/events/extract/places";
import {
  actsFromListingTitle,
  gigsFromJsonLd,
  itemListName,
  jsonLdBlocks,
  jsonLdEvents,
} from "@/domain/gigs/extract";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import type { PoliteFetcher } from "./polite-fetch";

export const HIGHAPE_BASE = "https://highape.com";
/** City pages listed in HighApe's sitemap. */
export const HIGHAPE_CITIES: Readonly<Record<string, string>> = {
  bangalore: "Bengaluru",
  "delhi-ncr": "Delhi",
  mumbai: "Mumbai",
  hyderabad: "Hyderabad",
  goa: "Goa",
};

export type HighApeDeps = {
  fetcher: PoliteFetcher;
  logger: Pick<Logger, "warn">;
  /** Limits the run to some city slugs (tests, one-off runs). */
  cities?: readonly string[];
};

export class HighApeSource implements CandidateSource {
  readonly source = "highape" as const;

  constructor(private readonly deps: HighApeDeps) {}

  async *collect(opts: CollectOptions): AsyncIterable<EventCandidate> {
    const slugs = this.deps.cities ?? Object.keys(HIGHAPE_CITIES);
    let pagesRead = 0;
    let lastError: unknown = null;
    for (const slug of slugs) {
      const url = `${HIGHAPE_BASE}/${slug}`;
      let html: string;
      try {
        html = await this.deps.fetcher.getText(url, { accept: "text/html" });
        pagesRead++;
      } catch (e) {
        lastError = e;
        this.deps.logger.warn({ source: this.source, url, err: e }, "highape: city page failed");
        continue;
      }
      const blocks = jsonLdBlocks(html);
      const heading = itemListName(blocks);
      const events = jsonLdEvents(blocks);
      if (events.length === 0) {
        this.deps.logger.warn({ source: this.source, url }, "highape: no events on the page");
        continue;
      }
      // The page's own heading names its city; the slug map is the fallback.
      const pageCity = (heading ? findCity(heading) : null) ?? HIGHAPE_CITIES[slug] ?? null;
      yield* gigsFromJsonLd(
        events,
        { url, city: pageCity, cityQuote: heading && findCity(heading) ? heading : null },
        {
          now: opts.now,
          source: this.source,
          trust: SOURCE_TRUST.highape,
          officialKind: "ticketing",
          via: "listing",
          acts: (e) => actsFromListingTitle(e.name),
        },
      );
    }
    if (pagesRead === 0 && lastError !== null) {
      throw lastError instanceof UpstreamError
        ? lastError
        : new UpstreamError("highape", "No HighApe city page could be read.");
    }
  }
}

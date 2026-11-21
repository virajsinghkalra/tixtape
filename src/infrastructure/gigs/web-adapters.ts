/**
 * Web adapters for gig coverage (D-073):
 * - `PolitePageReader`: one allowed page through PoliteFetcher (robots.txt, 1 req/s/host, SSRF
 *   guard, byte cap, D-070). Denied domains are refused here too, whatever the caller asks.
 * - `WikidataOfficialSites`: the artist's official website (P856) from their Spotify ID
 *   (P1902). CC0, MediaWiki API etiquette, cached for 30 days in the collector state.
 * - `LastfmTrendingArtists`: Last.fm `geo.getTopArtists` for India.
 */
import { articleMeta } from "./article-meta";
import { z } from "zod";
import type {
  OfficialSites,
  PageReader,
  ReadResult,
  TrendingArtists,
} from "@/application/gigs/ports";
import { DENIED_DOMAINS } from "@/domain/events/extract/allow-list";
import { decodeEntities, htmlToText } from "@/domain/events/extract/html";
import { safeHttpUrl } from "@/domain/events/http-url";
import { jsonLdBlocks } from "@/domain/gigs/extract";
import { onDomain } from "@/domain/gigs/registrable-domain";
import { UpstreamError } from "@/lib/errors";
import type { LastfmClient } from "../music-signals/lastfm";
import type { PoliteFetcher } from "../sources/polite-fetch";
import { WIKIDATA_API, WikidataClaimsSchema, WikidataSearchSchema } from "../sources/wikidata";

const TOUR_LINK = /\b(tour|tours|live|shows?|events?|concerts?|gigs?|dates)\b/iu;
const MAX_TOUR_LINKS = 5;

export class PolitePageReader implements PageReader {
  constructor(private readonly fetcher: PoliteFetcher) {}

  async read(url: string): Promise<ReadResult> {
    if (DENIED_DOMAINS.some((d) => onDomain(url, d))) {
      throw new UpstreamError(
        "gigs",
        `${new URL(url).host} may not be read automatically (D-073).`,
      );
    }
    let html: string;
    try {
      html = await this.fetcher.getText(url, { accept: "text/html, application/xhtml+xml" });
    } catch (e) {
      // PoliteFetcher reports HTTP errors as "<host> returned HTTP <status>."
      if (e instanceof UpstreamError && /returned HTTP (404|410)\b/u.test(e.message)) {
        return { status: "gone", url };
      }
      throw e;
    }
    return {
      status: "ok",
      url,
      title: pageTitle(html),
      text: htmlToText(html),
      jsonLd: jsonLdBlocks(html),
      tourLinks: tourLinks(html, url),
      image: ogImage(html, url),
      ...articleMeta(html),
    };
  }
}

function pageTitle(html: string): string {
  const og = /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/iu.exec(html)?.[1];
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1];
  return decodeEntities((og ?? title ?? "").replace(/\s+/gu, " ").trim()).slice(0, 300);
}

/** D-082: the page's `og:image` (or `twitter:image`) as an absolute https URL, or null. */
export function ogImage(html: string, base: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = tag[0];
    const key = /\b(?:property|name)=["']([^"']+)["']/iu.exec(attrs)?.[1]?.toLowerCase();
    if (key !== "og:image" && key !== "og:image:secure_url" && key !== "twitter:image") continue;
    const content = /\bcontent=["']([^"']+)["']/iu.exec(attrs)?.[1];
    if (!content) continue;
    try {
      const url = safeHttpUrl(new URL(decodeEntities(content.trim()), base).href);
      if (url?.startsWith("https://")) return url;
    } catch {
      continue;
    }
  }
  return null;
}

/** Same-host links that look like a tour or events page. */
export function tourLinks(html: string, base: string): string[] {
  const host = new URL(base).host;
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    let href: string;
    try {
      href = new URL(decodeEntities(m[1]!), base).href;
    } catch {
      continue;
    }
    const url = safeHttpUrl(href);
    if (!url || new URL(url).host !== host || url === base) continue;
    const label = htmlToText(m[2]!);
    if (!TOUR_LINK.test(new URL(url).pathname.replace(/[-_/]/gu, " ")) && !TOUR_LINK.test(label)) {
      continue;
    }
    if (!out.includes(url)) out.push(url);
    if (out.length >= MAX_TOUR_LINKS) break;
  }
  return out;
}

const TTL_MS = 30 * 86_400_000;

export interface OfficialSiteCache {
  getOfficialSites(spotifyId: string): Promise<{ value: string[]; checkedAt: Date } | undefined>;
  setOfficialSites(spotifyId: string, value: string[], checkedAt: Date): Promise<void>;
}

export class WikidataOfficialSites implements OfficialSites {
  constructor(
    private readonly deps: {
      fetcher: PoliteFetcher;
      cache: OfficialSiteCache | null;
      clock: { now(): Date };
    },
  ) {}

  async sitesOf(spotifyId: string): Promise<string[]> {
    if (!/^[0-9A-Za-z]{22}$/u.test(spotifyId)) return [];
    const now = this.deps.clock.now();
    const cached = await this.deps.cache?.getOfficialSites(spotifyId);
    if (cached && now.getTime() - cached.checkedAt.getTime() < TTL_MS) return cached.value;
    const sites = await this.lookup(spotifyId);
    await this.deps.cache?.setOfficialSites(spotifyId, sites, now);
    return sites;
  }

  private async json(params: Record<string, string>): Promise<unknown> {
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({ ...params, format: "json" }).toString();
    const text = await this.deps.fetcher.getText(url.href, {
      accept: "application/json",
      policy: "api-etiquette",
    });
    return JSON.parse(text);
  }

  private async lookup(spotifyId: string): Promise<string[]> {
    const found = WikidataSearchSchema.safeParse(
      await this.json({
        action: "query",
        list: "search",
        srsearch: `haswbstatement:P1902=${spotifyId}`,
      }),
    );
    const qid = found.success ? found.data.query.search[0]?.title : undefined;
    if (!qid) return [];
    const parsed = WikidataClaimsSchema.safeParse(
      await this.json({ action: "wbgetentities", ids: qid, props: "claims" }),
    );
    const claims = parsed.success ? (parsed.data.entities[qid]?.claims?.P856 ?? []) : [];
    return claims
      .map((c) => c.mainsnak.datavalue?.value)
      .flatMap((v) => (typeof v === "string" ? (safeHttpUrl(v) ?? []) : []))
      .filter((u) => !DENIED_DOMAINS.some((d) => onDomain(u, d)))
      .slice(0, 2);
  }
}

const TopArtistsSchema = z.object({
  topartists: z.object({
    artist: z.array(
      z.object({ name: z.string().min(1), listeners: z.coerce.number().int().nonnegative() }),
    ),
  }),
});

export class LastfmTrendingArtists implements TrendingArtists {
  constructor(private readonly client: LastfmClient) {}

  async topInIndia(limit: number) {
    const data = await this.client.get(
      { method: "geo.gettopartists", country: "India", limit: String(Math.min(limit, 200)) },
      TopArtistsSchema,
    );
    return (data?.topartists.artist ?? []).map((a) => ({ name: a.name, listeners: a.listeners }));
  }
}

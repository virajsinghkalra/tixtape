/**
 * Artist-first discovery (D-073): for one watchlist artist, find upcoming India shows on pages
 * we're allowed to read, and turn each night into a quote-grounded candidate.
 *  1. The artist's own site (Wikidata P856) and up to two of its tour/live pages: official.
 *  2. One web search (Tavily, D-064) for the artist's India shows:
 *     - allow-listed pages (outlets, organisers, HighApe) are fetched by us and read;
 *     - pages on sites we may not read (BookMyShow, District, Instagram, Linktree…) or don't
 *       know become **leads**: the URL and the search result's title only, for a human. Their
 *       text, whether snippet or cached copy, is never used.
 * Daily caps share the doubt resolver's counters (DOUBT_SEARCHES_PER_DAY). Nothing here
 * publishes: the caller validates artists on Spotify and stores candidates.
 */
import type { DoubtStore } from "@/application/ingestion/doubt-resolver";
import type { Clock } from "@/application/ports/clock";
import { AiUnavailableError, type WebSearch } from "@/application/ports/web-search";
import { allowedDomain, DENIED_DOMAINS } from "@/domain/events/extract/allow-list";
import { SOURCE_TRUST } from "@/domain/events/extract/candidate";
import { findCity } from "@/domain/events/extract/places";
import { istDay } from "@/domain/events/ist-calendar";
import {
  extractArtistGigs,
  gigsFromJsonLd,
  jsonLdEvents,
  namesArtist,
  type ExtractContext,
} from "@/domain/gigs/extract";
import type { GigCandidate } from "@/domain/gigs/provenance";
import { findDateMentions } from "@/domain/gigs/show-dates";
import { onDomain, registrableDomain } from "@/domain/gigs/registrable-domain";
import type { WatchArtist } from "@/domain/gigs/watchlist";
import type { Logger } from "@/lib/logger";
import type { GigLead, GigLeadStore, OfficialSites, PageReader, ReadResult } from "./ports";

const SEARCH_RESULTS = 10;
const DAY_MS = 86_400_000;
/** Leads per artist per run: enough for a human to act on, not a dump of search results. */
const MAX_LEADS = 5;
const TOUR_PAGES = 2;
export const DEFAULT_PAGES_PER_ARTIST = 4;

export type DiscoveryNote = {
  artist: string;
  officialSites: string[];
  searched: boolean;
  pages: Array<{ url: string; found: number; error?: string }>;
  leads: GigLead[];
  skipped?: string;
};

export type ArtistGigDiscoveryDeps = {
  search: WebSearch | null;
  reader: PageReader;
  officialSites: OfficialSites;
  leads: GigLeadStore | null;
  budget: DoubtStore;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn">;
  caps: { searchesPerDay: number };
  pagesPerArtist?: number;
};

const dayKey = (d: Date) => {
  const x = istDay(d);
  return `${x.year}-${String(x.month + 1).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`;
};

export class ArtistGigDiscovery {
  constructor(private readonly deps: ArtistGigDiscoveryDeps) {}

  /** Grounded candidates and leads for one artist. Never throws for one page or the search. */
  async discover(
    artist: WatchArtist,
  ): Promise<{ candidates: GigCandidate[]; note: DiscoveryNote }> {
    const now = this.deps.clock.now();
    const note: DiscoveryNote = {
      artist: artist.name,
      officialSites: [],
      searched: false,
      pages: [],
      leads: [],
    };
    const budget = { pages: this.deps.pagesPerArtist ?? DEFAULT_PAGES_PER_ARTIST };
    const read = new Set<string>();
    const out: GigCandidate[] = [];

    const official = artist.spotifyId ? await this.officialSites(artist.spotifyId) : [];
    note.officialSites = official;
    const officialDomains = official.flatMap((u) => registrableDomain(u) ?? []);
    for (const site of official) {
      const page = await this.read(site, note, read, budget);
      if (page?.status !== "ok") continue;
      out.push(...this.extract(page, artist.name, artistSite(now)));
      for (const link of page.tourLinks.slice(0, TOUR_PAGES)) {
        const tour = await this.read(link, note, read, budget);
        if (tour?.status === "ok") out.push(...this.extract(tour, artist.name, artistSite(now)));
      }
    }

    const results = await this.search(artist.name, now, note);
    for (const r of results) {
      const domain = registrableDomain(r.url);
      if (!domain || read.has(r.url)) continue;
      const ctx = contextFor(r.url, officialDomains, now);
      if (!ctx) {
        const lead = leadFor(artist.name, r, domain, now);
        if (lead && note.leads.length < MAX_LEADS) note.leads.push(lead);
        continue;
      }
      const page = await this.read(r.url, note, read, budget);
      if (page?.status === "ok") out.push(...this.extract(page, artist.name, ctx));
    }
    for (const lead of note.leads) {
      try {
        await this.deps.leads?.upsert(lead, now);
      } catch (e) {
        this.deps.logger.warn({ err: e, url: lead.url }, "gigs: lead not saved");
      }
    }
    return { candidates: dedupe(out), note };
  }

  private async officialSites(spotifyId: string): Promise<string[]> {
    try {
      return await this.deps.officialSites.sitesOf(spotifyId);
    } catch (e) {
      this.deps.logger.warn({ err: e, spotifyId }, "gigs: official site lookup failed");
      return [];
    }
  }

  private async search(name: string, now: Date, note: DiscoveryNote) {
    if (!this.deps.search) return [];
    const day = dayKey(now);
    const used = await this.deps.budget.usage(day);
    if (used.searches >= this.deps.caps.searchesPerDay) {
      note.skipped = `daily search cap (${this.deps.caps.searchesPerDay}) reached`;
      return [];
    }
    const year = istDay(now).year;
    try {
      await this.deps.budget.addUsage(day, { searches: 1 });
      note.searched = true;
      // Denied domains are not excluded: their results become leads, and are never fetched.
      return await this.deps.search.search(
        // Measured 2026-11-21: naming big cities surfaces Indian ticket and venue pages best.
        `"${name}" tickets India ${year} ${year + 1} Mumbai Delhi Bengaluru`,
        { maxResults: SEARCH_RESULTS, excludeDomains: [] },
      );
    } catch (e) {
      note.skipped = e instanceof AiUnavailableError ? e.message : `search failed: ${String(e)}`;
      this.deps.logger.warn({ err: e, artist: name }, "gigs: search failed");
      return [];
    }
  }

  private async read(
    url: string,
    note: DiscoveryNote,
    read: Set<string>,
    budget: { pages: number },
  ): Promise<ReadResult | null> {
    if (read.has(url) || budget.pages <= 0) return null;
    read.add(url);
    budget.pages--;
    try {
      const page = await this.deps.reader.read(url);
      if (page.status === "gone") note.pages.push({ url, found: 0, error: "gone" });
      return page;
    } catch (e) {
      note.pages.push({ url, found: 0, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  private extract(
    page: Extract<ReadResult, { status: "ok" }>,
    artist: string,
    ctx: ExtractContext,
  ): GigCandidate[] {
    const text = extractArtistGigs(page, artist, ctx);
    // JSON-LD events count when they name the artist (title or performer).
    const events = jsonLdEvents(page.jsonLd).filter(
      (e) => namesArtist(e.name, artist) || e.performers.some((p) => namesArtist(p, artist)),
    );
    const structured = gigsFromJsonLd(
      events,
      { url: page.url, city: null, cityQuote: null },
      { ...ctx, acts: () => [{ name: artist, parts: [] }] },
    );
    const found = dedupe([...structured, ...text]);
    const entry = { url: page.url, found: found.length };
    this.deps.logger.info(entry, "gigs: page read");
    return found;
  }
}

function artistSite(now: Date): ExtractContext {
  return {
    now,
    source: "artist_site",
    trust: SOURCE_TRUST.artist_site,
    officialKind: "artist",
    via: "artist_site",
  };
}

/** How to read a search result, or null when we may not read it (it may become a lead). */
function contextFor(
  url: string,
  officialDomains: readonly string[],
  now: Date,
): ExtractContext | null {
  if (officialDomains.some((d) => onDomain(url, d))) return artistSite(now);
  const allowed = allowedDomain(url);
  if (!allowed) return null;
  const official = allowed.trust === "official";
  return {
    now,
    source: allowed.source ?? "gig_web",
    trust: allowed.trust,
    officialKind: allowed.source === "highape" ? "ticketing" : official ? "organiser" : null,
    via: "search",
  };
}

/** A lead when the result's title names the artist and an Indian city (title only, D-073). */
function leadFor(
  artist: string,
  r: { url: string; title: string },
  domain: string,
  now: Date,
): GigLead | null {
  if (!namesArtist(r.title, artist)) return null;
  // A title that only names past dates ("… Apr 18, 2026") is about a show that's over.
  const dates = findDateMentions(r.title).flatMap((m) =>
    m.kind === "nights" ? m.nights : [m.end],
  );
  if (dates.length > 0 && dates.every((d) => d.getTime() < now.getTime() - DAY_MS)) return null;
  if (
    !findCity(r.title) &&
    !findCity(decodeURIComponent(new URL(r.url).pathname).replace(/[-/_]/gu, " "))
  ) {
    return null;
  }
  return {
    artist,
    url: r.url,
    domain,
    title: r.title.slice(0, 300),
    reason: DENIED_DOMAINS.some((d) => onDomain(r.url, d)) ? "denied_domain" : "unknown_domain",
  };
}

function dedupe(candidates: readonly GigCandidate[]): GigCandidate[] {
  const seen = new Map<string, GigCandidate>();
  for (const c of candidates) {
    const key = `${c.source}|${c.externalId}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

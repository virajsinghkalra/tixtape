/**
 * The free doubt resolver (D-062, D-064). Called only for events in doubt (missing lineup,
 * venue or explicit date; a date or city conflict; confidence just under publishing):
 *   1. one web search (Tavily) for the event;
 *   2. keep only allow-listed domains, never denied ones;
 *   3. grounded extraction (GitHub Models) from at most two of those pages;
 *   4. keep only facts whose quote is verbatim in the page and states the fact.
 * What survives becomes an ordinary candidate whose source is the page (its real URL), so the
 * D-056 layers decide as for any other source. The model is never a source.
 * Results are cached for 24 h by (event, page, content hash); searches and model calls have
 * daily caps; a 429 or quota error switches the resolver off for the rest of the run.
 */
import { createHash } from "node:crypto";
import type { Clock } from "@/application/ports/clock";
import {
  AiUnavailableError,
  type GroundedExtractor,
  type WebPage,
  type WebSearch,
} from "@/application/ports/web-search";
import { allowedDomain, DENIED_DOMAINS } from "@/domain/events/extract/allow-list";
import type { ArtistMention, EventCandidate } from "@/domain/events/extract/candidate";
import { groundExtraction } from "@/domain/events/extract/grounding";
import type { Verification } from "@/domain/events/extract/verify";
import { istDay } from "@/domain/events/ist-calendar";
import type { Logger } from "@/lib/logger";

const CACHE_TTL_MS = 24 * 3_600_000;
const SEARCH_RESULTS = 6;
const PAGES_PER_EVENT = 2;
export const DEFAULT_CAPS = { searchesPerDay: 30, modelCallsPerDay: 30 } as const;

/** Daily counters and the 24 h extraction cache (file-backed in the script). */
export interface DoubtStore {
  usage(day: string): Promise<{ searches: number; modelCalls: number }>;
  addUsage(day: string, delta: { searches?: number; modelCalls?: number }): Promise<void>;
  cached(key: string): Promise<{ value: unknown; at: Date } | undefined>;
  cache(key: string, value: unknown, at: Date): Promise<void>;
}

export type DoubtTarget = {
  /** Stable for the event: an event ID or the cluster's lead candidate key. */
  key: string;
  title: string;
  city: string;
  startsAt: Date;
};

export type DoubtNote = {
  title: string;
  reasons: string[];
  outcome: string;
  /** Hosts the search returned, allowed or not (for review). */
  searched: string[];
  pages: Array<{ url: string; kept: string[]; dropped: string[] }>;
};

export type DoubtUsage = {
  searches: number;
  modelCalls: number;
  cacheHits: number;
  notes: DoubtNote[];
  /** Set when the resolver switched itself off this run (cap, 429, quota). */
  stopped: string | null;
};

/** Why an event is in doubt (D-062), or an empty list when it isn't. */
export function doubtReasons(v: Verification): string[] {
  const reasons: string[] = [];
  const f = v.fields;
  if (f.headliners.status === "missing" || f.headliners.status === "single") {
    reasons.push(`lineup ${f.headliners.status}`);
  }
  if (f.venue.status === "missing") reasons.push("venue missing");
  if (v.checks.some((c) => c.name === "date_explicit" && c.ok === false)) {
    reasons.push("date not explicit");
  }
  if (f.date.status === "conflict") reasons.push("date conflict");
  if (f.city.status === "conflict") reasons.push("city conflict");
  if (v.passes && v.confidence >= 0.75 && v.confidence < 0.9) {
    reasons.push(`confidence ${v.confidence} just under 0.9`);
  }
  return reasons;
}

const isoDay = (d: Date) => {
  const day = istDay(d);
  return `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export class DoubtResolver {
  readonly usage: DoubtUsage = {
    searches: 0,
    modelCalls: 0,
    cacheHits: 0,
    notes: [],
    stopped: null,
  };

  constructor(
    private readonly deps: {
      search: WebSearch;
      extractor: GroundedExtractor;
      /**
       * D-070: our own fetch of an allowed page (PoliteFetcher: robots, SSRF guard, byte cap),
       * as plain text. Search snippets are only used to choose pages, never as evidence.
       */
      fetchPage(url: string): Promise<string>;
      store: DoubtStore;
      clock: Clock;
      logger: Pick<Logger, "info" | "warn">;
      caps?: { searchesPerDay: number; modelCallsPerDay: number };
    },
  ) {}

  /** Grounded candidates for one doubtful event (possibly none). Never throws for AI limits. */
  async resolve(target: DoubtTarget, reasons: readonly string[]): Promise<EventCandidate[]> {
    const note: DoubtNote = {
      title: target.title,
      reasons: [...reasons],
      outcome: "",
      searched: [],
      pages: [],
    };
    this.usage.notes.push(note);
    if (this.usage.stopped) {
      note.outcome = `skipped: ${this.usage.stopped}`;
      return [];
    }
    const caps = this.deps.caps ?? DEFAULT_CAPS;
    const now = this.deps.clock.now();
    const day = isoDay(now);
    try {
      const used = await this.deps.store.usage(day);
      if (used.searches >= caps.searchesPerDay) {
        return this.stop(note, `daily search cap (${caps.searchesPerDay}) reached`);
      }
      const year = istDay(target.startsAt).year;
      const pages = await this.deps.search.search(`${target.title} ${target.city} ${year} lineup`, {
        maxResults: SEARCH_RESULTS,
        excludeDomains: DENIED_DOMAINS,
      });
      this.usage.searches++;
      await this.deps.store.addUsage(day, { searches: 1 });
      note.searched = pages.map((p) => {
        try {
          return new URL(p.url).hostname;
        } catch {
          return p.url;
        }
      });
      const allowed = pages.filter((p) => allowedDomain(p.url) !== null).slice(0, PAGES_PER_EVENT);
      if (allowed.length === 0) {
        note.outcome = "no allow-listed pages found";
        return [];
      }
      const out: EventCandidate[] = [];
      for (const found of allowed) {
        let page: WebPage;
        try {
          page = {
            url: found.url,
            title: found.title,
            content: await this.deps.fetchPage(found.url),
          };
        } catch (e) {
          note.pages.push({
            url: found.url,
            kept: [],
            dropped: [`page: could not be fetched (${e instanceof Error ? e.message : String(e)})`],
          });
          continue;
        }
        const raw = await this.extract(target, page, day, caps.modelCallsPerDay, note);
        if (raw === undefined) break;
        const facts = groundExtraction(raw, page.content);
        const candidate = this.toCandidate(facts, page);
        note.pages.push({
          url: page.url,
          kept: candidate ? keptFields(facts) : [],
          dropped: candidate
            ? facts.dropped
            : [...facts.dropped, "page: no grounded title, explicit date and city"],
        });
        if (candidate) out.push(candidate);
      }
      note.outcome ||= `${out.length} grounded page(s)`;
      return out;
    } catch (e) {
      if (e instanceof AiUnavailableError) return this.stop(note, e.message);
      this.deps.logger.warn({ err: e, title: target.title }, "doubt resolver: failed");
      note.outcome = `failed: ${e instanceof Error ? e.message : String(e)}`;
      return [];
    }
  }

  private stop(note: DoubtNote, why: string): EventCandidate[] {
    this.usage.stopped = why;
    note.outcome = `skipped: ${why}`;
    this.deps.logger.warn({ why }, "doubt resolver: stopped for this run");
    return [];
  }

  /** The model's reply for this page, from the 24 h cache when the page text is unchanged. */
  private async extract(
    target: DoubtTarget,
    page: WebPage,
    day: string,
    cap: number,
    note: DoubtNote,
  ): Promise<unknown> {
    const now = this.deps.clock.now();
    const key = `${target.key}|${page.url}|${hash(page.content)}`;
    const cached = await this.deps.store.cached(key);
    if (cached && now.getTime() - cached.at.getTime() < CACHE_TTL_MS) {
      this.usage.cacheHits++;
      return cached.value;
    }
    if ((await this.deps.store.usage(day)).modelCalls >= cap) {
      this.stop(note, `daily model-call cap (${cap}) reached`);
      return undefined;
    }
    // Counted before the call: a failed call still uses the daily allowance.
    this.usage.modelCalls++;
    await this.deps.store.addUsage(day, { modelCalls: 1 });
    const value = await this.deps.extractor.extract({
      event: { title: target.title, city: target.city, date: isoDay(target.startsAt) },
      page,
    });
    await this.deps.store.cache(key, value, now);
    return value;
  }

  /** A candidate from a grounded page: it needs a grounded title, explicit date and city. */
  private toCandidate(
    facts: ReturnType<typeof groundExtraction>,
    page: WebPage,
  ): EventCandidate | null {
    const domain = allowedDomain(page.url);
    if (!domain || !facts.title || !facts.startsAt || !facts.city) return null;
    const mention = (name: string, role?: "support"): ArtistMention =>
      role ? { name, parts: [], role } : { name, parts: [] };
    return {
      source: domain.source ?? "web",
      trust: domain.trust,
      externalId: `page:${page.url}`,
      url: page.url,
      title: facts.title,
      type: /\b(festival|fest|weekender)\b/iu.test(facts.title) ? "festival" : "concert",
      startsAt: facts.startsAt,
      endsAt: facts.endsAt,
      dateExplicit: true,
      city: facts.city,
      country: "IN",
      venueName: facts.venue,
      artists: [
        ...facts.headliners.map((n) => mention(n)),
        ...facts.support.map((n) => mention(n, "support")),
      ],
      confidence: 0.7,
      fingerprint: page.url,
    };
  }
}

function keptFields(f: ReturnType<typeof groundExtraction>): string[] {
  return [
    f.title ? `title: ${f.title}` : null,
    f.startsAt ? `date: ${isoDay(f.startsAt)}${f.endsAt ? ` – ${isoDay(f.endsAt)}` : ""}` : null,
    f.city ? `city: ${f.city}` : null,
    f.venue ? `venue: ${f.venue}` : null,
    f.headliners.length > 0 ? `headliners: ${f.headliners.join(", ")}` : null,
    f.support.length > 0 ? `support: ${f.support.join(", ")}` : null,
  ].filter((x): x is string => x !== null);
}

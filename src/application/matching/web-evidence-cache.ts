import type { WebPage } from "@/application/ports/web-search";

/**
 * D-066: web search results by query, kept 30 days so a re-run doesn't spend search credits
 * again. In memory until a table exists (proposed with D-016's candidates table).
 */
export interface WebEvidenceCache {
  get(query: string): Promise<{ pages: WebPage[]; fetchedAt: Date } | null>;
  set(query: string, pages: WebPage[], fetchedAt: Date): Promise<void>;
}

export const WEB_EVIDENCE_TTL_DAYS = 30;

export function createInMemoryWebEvidenceCache(): WebEvidenceCache {
  const entries = new Map<string, { pages: WebPage[]; fetchedAt: Date }>();
  return {
    async get(query) {
      return entries.get(query) ?? null;
    },
    async set(query, pages, fetchedAt) {
      entries.set(query, { pages, fetchedAt });
    },
  };
}

/** Web searches cost credits: each run gets a fixed number (D-066). */
export class WebSearchBudget {
  constructor(private remaining: number) {}

  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }

  /** The search service said stop (rate limit or quota): no more searches this run. */
  exhaust(): void {
    this.remaining = 0;
  }

  get left(): number {
    return this.remaining;
  }
}

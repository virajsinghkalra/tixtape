/**
 * D-089: press articles already collected by the news readers (Rolling Stone India and Pollstar
 * RSS, the doubt resolver, search) are stored without quotes or a publication date, so they
 * can't count for the press path. This step re-reads each upcoming one on a readable D-087
 * outlet (politely, a few per run), finds the same night for the same headliner and city with
 * rule-based, quote-grounded extraction, and stores it again under its own source and ID with
 * the article's provenance (publisher, date, wire, quotes). Nothing is published here.
 */
import type { CandidateStore } from "@/application/ingestion/ports";
import type { Clock } from "@/application/ports/clock";
import { dedupeKey } from "@/domain/events/dedupe";
import { normalizeCity } from "@/domain/events/venue";
import { extractArtistGigs, isoDate } from "@/domain/gigs/extract";
import type { ValidatedGig } from "@/domain/gigs/nights";
import { pressMeta, pressOutlet } from "@/domain/gigs/press";
import type { Logger } from "@/lib/logger";
import type { GigCandidateReader, PageReader } from "./ports";

const DAY_MS = 86_400_000;
export const ENRICH_PAGES_PER_RUN = 6;

export type EnrichReport = {
  read: number;
  enriched: ValidatedGig[];
  failed: Array<{ url: string; error: string }>;
};

export async function enrichPress(
  deps: {
    candidates: GigCandidateReader;
    reader: PageReader;
    store: Pick<CandidateStore, "upsert">;
    clock: Clock;
    logger: Pick<Logger, "warn">;
  },
  opts: { write: boolean; limit?: number },
): Promise<EnrichReport> {
  const now = deps.clock.now();
  const report: EnrichReport = { read: 0, enriched: [], failed: [] };
  const pool = await deps.candidates.listUpcoming(
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() - 30 * DAY_MS),
  );
  const todo = pool.filter(
    (c) => !c.provenance?.press && c.artists.length > 0 && pressOutlet(c.url)?.readable === true,
  );
  const byUrl = new Map<string, ValidatedGig[]>();
  for (const c of todo) byUrl.set(c.url, [...(byUrl.get(c.url) ?? []), c]);
  for (const [url, members] of [...byUrl].slice(0, opts.limit ?? ENRICH_PAGES_PER_RUN)) {
    let page;
    try {
      page = await deps.reader.read(url);
      report.read++;
    } catch (e) {
      report.failed.push({ url, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (page.status !== "ok") continue;
    const press = pressMeta({
      url,
      text: page.text,
      published: page.published ?? null,
      byline: page.byline ?? null,
    });
    if (!press) continue;
    for (const c of members) {
      const headliner = c.artists[0]!;
      const match = extractArtistGigs(page, headliner, {
        now,
        source: c.source,
        trust: c.trust,
        officialKind: null,
        via: "press",
      }).find(
        (f) =>
          isoDate(f.startsAt) === isoDate(c.startsAt) &&
          normalizeCity(f.city) === normalizeCity(c.city),
      );
      if (!match) continue;
      const enriched: ValidatedGig = {
        ...c,
        ...(match.cancelled ? { cancelled: true } : {}),
        provenance: { ...match.provenance, press },
      };
      if (opts.write) await deps.store.upsert(enriched, dedupeKey(enriched), now);
      report.enriched.push(enriched);
    }
  }
  return report;
}

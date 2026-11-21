/**
 * Composition for gig coverage (D-073, D-074). The Lead wires it into src/server/container.ts;
 * until then src/scripts/discover-gigs.ts builds it from the container's base pieces.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { ArtistGigDiscovery } from "@/application/gigs/discover-artist-gigs";
import type { DoubtStore } from "@/application/ingestion/doubt-resolver";
import type { Clock } from "@/application/ports/clock";
import type { Database } from "@/db/client";
import type { EventId } from "@/domain/shared/ids";
import type { Logger } from "@/lib/logger";
import { TavilySearch } from "../ai/tavily";
import { LastfmClient } from "../music-signals/lastfm";
import { HighApeSource } from "../sources/highape";
import { createMemoryHostLog, PoliteFetcher, type HostLog } from "../sources/polite-fetch";
import {
  PgArtistMatches,
  PgCatalogueArtists,
  PgGateDecisionStore,
  PgGigCandidateReader,
  PgGigLeadStore,
  PgPublishAuditLog,
  PgPublishSwitch,
  PgSearchedTerms,
} from "./pg-gig-stores";
import { PgArtistCities, PgCityDemandStore, PgCityShowCounts } from "./pg-demand-stores";
import { LastfmTrendingArtists, PolitePageReader, WikidataOfficialSites } from "./web-adapters";

/** D-074: the kill switch. Anything but the exact string "true" means off (fail closed). */
export const GigEnvSchema = z.object({
  AUTO_PUBLISH_ENABLED: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() === "true"),
  /** Watchlist artists per scheduled run (searches are also capped by DOUBT_SEARCHES_PER_DAY). */
  GIG_ARTISTS_PER_RUN: z.coerce.number().int().min(0).max(100).default(15),
});
export type GigEnv = z.infer<typeof GigEnvSchema>;

export type GigsModuleDeps = {
  db: Database;
  clock: Clock;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  lastfmApiKey?: string;
  tavilyApiKey?: string;
  searchesPerDay: number;
  autoPublishEnabled: boolean;
};

export function createGigsModule(deps: GigsModuleDeps) {
  const fetchImpl = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetcherFor = (hostLog: HostLog) =>
    new PoliteFetcher({ fetch: fetchImpl, sleep, clock: deps.clock, logger: deps.logger, hostLog });
  const lastfm = deps.lastfmApiKey
    ? new LastfmClient({ apiKey: deps.lastfmApiKey, fetch: fetchImpl, sleep, clock: deps.clock })
    : null;
  return {
    stores: {
      candidates: new PgGigCandidateReader(deps.db),
      decisions: new PgGateDecisionStore(deps.db),
      audit: new PgPublishAuditLog(deps.db),
      leads: new PgGigLeadStore(deps.db),
      matches: new PgArtistMatches(deps.db),
    },
    watchlist: {
      trending: lastfm ? new LastfmTrendingArtists(lastfm) : null,
      catalogue: new PgCatalogueArtists(deps.db),
      searched: new PgSearchedTerms(deps.db),
    },
    publishSwitch: new PgPublishSwitch(deps.db, deps.autoPublishEnabled),
    reader: (state: HostLog) => new PolitePageReader(fetcherFor(state)),
    /** Night-level gig listings (D-073): HighApe's city pages, in demand order (D-081). */
    listings: (state: HostLog, cities?: readonly string[]) => [
      new HighApeSource({ fetcher: fetcherFor(state), logger: deps.logger, cities }),
    ],
    /** D-081: visitor demand by city, shows per city, and where our artists play. */
    demand: {
      demand: new PgCityDemandStore(deps.db),
      shows: new PgCityShowCounts(deps.db),
      artistCities: new PgArtistCities(deps.db),
    },
    /** Artist-first discovery; `state` keeps crawl pacing and the shared daily counters. */
    discovery: (state: HostLog & DoubtStore, opts: { write: boolean }) =>
      new ArtistGigDiscovery({
        search: deps.tavilyApiKey
          ? new TavilySearch({ apiKey: deps.tavilyApiKey, fetch: fetchImpl })
          : null,
        reader: new PolitePageReader(fetcherFor(state)),
        officialSites: new WikidataOfficialSites({
          fetcher: fetcherFor(state),
          cache: null,
          clock: deps.clock,
        }),
        leads: opts.write ? new PgGigLeadStore(deps.db) : null,
        budget: state,
        clock: deps.clock,
        logger: deps.logger,
        caps: { searchesPerDay: deps.searchesPerDay },
      }),
    /**
     * D-074 re-verification: the same night at a new start time. Only the time of day moves;
     * the IST date (and so the event's identity) is unchanged.
     */
    updateStartTime: async (eventId: EventId, night: string, hhmm: string) => {
      const startsAt = new Date(`${night}T${hhmm}:00+05:30`);
      await deps.db.execute(sql`
        update events set starts_at = ${startsAt.toISOString()}::timestamptz, starts_at_date_only = false, updated_at = now()
        where id = ${eventId}::uuid`);
    },
  };
}

export type GigsModule = ReturnType<typeof createGigsModule>;

/**
 * Per-process crawl pacing and search counters, for the live lookup on serverless (no state
 * file). The real daily cap there is a Postgres limiter in the container.
 */
export function createMemoryGigState(): HostLog & DoubtStore {
  const usage = new Map<string, { searches: number; modelCalls: number }>();
  const cache = new Map<string, { value: unknown; at: Date }>();
  return {
    ...createMemoryHostLog(),
    usage: async (day) => usage.get(day) ?? { searches: 0, modelCalls: 0 },
    addUsage: async (day, d) => {
      const u = usage.get(day) ?? { searches: 0, modelCalls: 0 };
      usage.set(day, {
        searches: u.searches + (d.searches ?? 0),
        modelCalls: u.modelCalls + (d.modelCalls ?? 0),
      });
    },
    cached: async (key) => cache.get(key),
    cache: async (key, value, at) => {
      cache.set(key, { value, at });
    },
  };
}

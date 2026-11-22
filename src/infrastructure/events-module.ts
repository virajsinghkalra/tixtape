/**
 * Composition for Events & Ingestion (D-014). The Lead wires this into the container;
 * until then src/server/events.ts builds it from `container()`.
 */
import { createEventsUseCases, type EventsUseCases } from "@/application/events";
import type { ArtistRepository } from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { Database } from "@/db/client";
import type { Logger } from "@/lib/logger";
import { PgArtistRepository } from "./db/artist-repository";
import { PgEventRepository } from "./db/event-repository";
import { PgEventSearch } from "./db/event-search";
import { PgEventStatsRollup } from "./db/event-stats-repository";
import { PgIngestRunRepository } from "./db/ingest-run-repository";
import { PgSearchLogRepository } from "./db/search-log-repository";
import { PgVenueRepository } from "./db/venue-repository";
import { TicketmasterSource } from "./sources/ticketmaster";
import { createMemoryHostLog, PoliteFetcher, type HostLog } from "./sources/polite-fetch";
import { PollstarSource } from "./sources/pollstar";
import { RollingStoneIndiaSource } from "./sources/rollingstone";
import { SunburnSource } from "./sources/sunburn";
import { TeamInnovationSource } from "./sources/teaminnovation";
import { WikipediaSource } from "./sources/wikipedia";
import type {
  ArtistIdentityLookup,
  CandidateStore,
  EventVerificationStore,
  VenueGeocoder,
} from "@/application/ingestion/ports";
import type { EventId } from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";
import { htmlToText } from "@/domain/events/extract/html";
import { PgEventCandidateRepository } from "./db/event-candidate-repository";
import { PgEventVerificationRepository } from "./db/event-verification-repository";
import { NominatimGeocoder, type GeocodeCache } from "./sources/geocoder";
import { WikidataMusicBrainzIdentity, type IdentityCache } from "./sources/identity";

export type EventsModule = EventsUseCases & {
  /** The shared artist repository (also needed by Artist Matching). */
  artistRepository: ArtistRepository;
  /** A Ticketmaster adapter for `ingest`, e.g. `ticketmasterSource({ apiKey, countryCodes: ["IN"] })`. */
  ticketmasterSource(config: {
    apiKey: string;
    countryCodes: readonly string[];
    keyword?: string;
  }): SourceAdapter;
  /** P1.11 collector sources sharing one polite fetcher; `hostLog` keeps crawl-delays across runs. */
  collectorSources(
    hostLog?: HostLog,
    options?: { rollingStoneFeed?: string },
  ): {
    rollingstone: RollingStoneIndiaSource;
    pollstar: PollstarSource;
    wikipedia: WikipediaSource;
    sunburn: SunburnSource;
    teaminnovation: TeamInnovationSource;
  };
  /** P1.11/D-056 stores and checks for the collector; `state` caches lookups between runs. */
  collectorServices(state: HostLog & IdentityCache & GeocodeCache): {
    candidates: CandidateStore;
    verification: EventVerificationStore;
    identity: ArtistIdentityLookup;
    geocoder: VenueGeocoder;
    findEventId(source: EventSource, externalId: string): Promise<EventId | null>;
    /** D-070: an allowed page fetched politely (robots, SSRF guard, caps), as plain text. */
    fetchPageText(url: string): Promise<string>;
  };
};

export function createEventsModule(deps: {
  db: Database;
  clock: Clock;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): EventsModule {
  const artists = new PgArtistRepository(deps.db);
  const eventRepository = new PgEventRepository(deps.db);
  const fetchImpl = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const useCases = createEventsUseCases({
    events: eventRepository,
    venues: new PgVenueRepository(deps.db),
    artists,
    ingestRuns: new PgIngestRunRepository(deps.db),
    search: new PgEventSearch(deps.db),
    statsRollup: new PgEventStatsRollup(deps.db),
    searchLog: new PgSearchLogRepository(deps.db),
    clock: deps.clock,
    logger: deps.logger,
  });
  return {
    ...useCases,
    artistRepository: artists,
    ticketmasterSource: (config) =>
      new TicketmasterSource({
        ...config,
        fetch: fetchImpl,
        sleep,
        clock: deps.clock,
        logger: deps.logger,
      }),
    collectorSources: (hostLog = createMemoryHostLog(), options = {}) => {
      const fetcher = new PoliteFetcher({
        fetch: fetchImpl,
        sleep,
        clock: deps.clock,
        logger: deps.logger,
        hostLog,
      });
      const d = { fetcher, logger: deps.logger };
      return {
        rollingstone: new RollingStoneIndiaSource({ ...d, feed: options.rollingStoneFeed }),
        pollstar: new PollstarSource(d),
        wikipedia: new WikipediaSource(d),
        sunburn: new SunburnSource(d),
        teaminnovation: new TeamInnovationSource(d),
      };
    },
    collectorServices: (state) => {
      const fetcher = new PoliteFetcher({
        fetch: fetchImpl,
        sleep,
        clock: deps.clock,
        logger: deps.logger,
        hostLog: state,
      });
      return {
        candidates: new PgEventCandidateRepository(deps.db),
        verification: new PgEventVerificationRepository(deps.db),
        identity: new WikidataMusicBrainzIdentity({ fetcher, cache: state, clock: deps.clock }),
        geocoder: new NominatimGeocoder({ fetcher, cache: state }),
        findEventId: (source, externalId) => eventRepository.findIdBySourceRef(source, externalId),
        fetchPageText: async (url) =>
          htmlToText(await fetcher.getText(url, { accept: "text/html, application/xhtml+xml" })),
      };
    },
  };
}

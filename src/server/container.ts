/**
 * Composition root (ENGINEERING.md §2, D-004, D-014). The only place that knows which
 * infrastructure adapter implements which application port. Routes and scripts reach modules
 * through the thin helpers in src/server/* (`events()`, `matching()`, `playlists()`, …), which
 * read from here.
 *
 * One container per process, built lazily: each module is created on first use, so a route
 * that only reads events never needs Spotify credentials. The container lives on `globalThis`
 * so dev hot reloads and separately bundled route modules share one DB pool, one lookup cache
 * and one rate-limiter set instead of duplicating them.
 */
import { createAdminConsole, type AdminConsole } from "@/application/admin";
import { SpotifyAuthService } from "@/application/auth/spotify-auth-service";
import { STARTS_PER_HOUR } from "@/application/playlists";
import { artistGigLookup } from "@/application/gigs/run-discovery";
import { LiveLookup } from "@/application/ingestion/live-lookup";
import { createMemoryValidationCache } from "@/application/ingestion/ports";
import { ArtistValidator } from "@/application/ingestion/validate-artists";
import {
  createMatchingModule,
  type EventLineupReader,
  type MatchingModule,
} from "@/application/matching";
import type { Alerts } from "@/application/ports/alerts";
import { systemClock, systemRandom, type Clock, type Random } from "@/application/ports/clock";
import { createDb, type Database } from "@/db/client";
import { TavilySearch } from "@/infrastructure/ai/tavily";
import { createAlerts } from "@/infrastructure/alerts";
import { createEventsModule, type EventsModule } from "@/infrastructure/events-module";
import { PgAdminConsoleRepository } from "@/infrastructure/db/admin-console-repository";
import { PgArtistRepository } from "@/infrastructure/db/artist-repository";
import { PgEventCandidateRepository } from "@/infrastructure/db/event-candidate-repository";
import {
  createGigsModule,
  createMemoryGigState,
  GigEnvSchema,
  type GigsModule,
} from "@/infrastructure/gigs/gigs-module";
import { PgLookupCache } from "@/infrastructure/db/lookup-cache-repository";
import { PgMatchCandidateStore } from "@/infrastructure/db/match-candidate-store";
import { PgRateLimiter, PgStartLimiter } from "@/infrastructure/db/pg-rate-limiter";
import {
  createPlaylistsModule,
  fetchWithTimeout,
  PLAYLIST_STEP_SPOTIFY_HTTP,
  type PlaylistsModule,
} from "@/infrastructure/playlists-module";
import {
  createSpotifyModule,
  type SpotifyHttpConfig,
  type SpotifyModule,
} from "@/infrastructure/spotify";
import { env, requireEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/logger";

export type Container = {
  db: Database;
  logger: Logger;
  clock: Clock;
  random: Random;
  /** App-wide Spotify module: auth, artist matching, lookup, ingest validation. */
  readonly spotify: SpotifyModule;
  /**
   * D-043: the Playlist Engine's own Spotify instance, with retry settings that fit the 8 s
   * step budget. The shared gate is in Postgres, so pauses apply across both instances.
   */
  readonly engineSpotify: SpotifyModule;
  readonly auth: SpotifyAuthService;
  readonly events: EventsModule;
  readonly matching: MatchingModule;
  readonly playlists: PlaylistsModule;
  readonly lookup: LiveLookup;
  readonly alerts: Alerts;
  readonly adminConsole: AdminConsole;
  /** D-073/D-074 Gig Coverage: discovery, the auto-publish gate and re-verification. */
  readonly gigs: GigsModule;
};

/** Defines a getter that builds its value on first read and keeps it. */
function lazy<K extends keyof Container>(c: Container, key: K, build: () => Container[K]): void {
  let value: Container[K] | undefined;
  Object.defineProperty(c, key, {
    enumerable: true,
    get: () => (value ??= build()),
  });
}

function spotifyFor(
  base: Pick<Container, "db" | "clock" | "random" | "logger">,
  overrides: { http?: Partial<SpotifyHttpConfig>; fetch?: typeof fetch } = {},
): SpotifyModule {
  return createSpotifyModule({
    db: base.db,
    clock: base.clock,
    random: base.random,
    logger: base.logger,
    spotify: {
      clientId: requireEnv("SPOTIFY_CLIENT_ID"),
      clientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
      redirectUri: new URL("/api/auth/spotify/callback", env().APP_URL).toString(),
    },
    tokenEncryption: { key: requireEnv("TOKEN_ENC_KEY"), version: env().TOKEN_ENC_KEY_VERSION },
    ...overrides,
  });
}

/** D-066: an event's lineup as Matching reads it, from the admin read (any visibility). */
function eventLineups(events: EventsModule): EventLineupReader {
  return {
    async getEventLineup(id) {
      try {
        const e = await events.getAdminEvent(id);
        return {
          title: e.title,
          city: e.venue?.city ?? null,
          genre: e.genre,
          artists: e.lineup.map((a) => ({ artistId: a.artistId, matchStatus: a.matchStatus })),
        };
      } catch (err) {
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
  };
}

/**
 * D-070: limits held in Postgres, so they apply across every serverless instance. Stored keys
 * are an HMAC with SESSION_SECRET, never raw client IPs.
 */
function pgLimiter(c: Container, name: string, limit: number, windowMs: number): PgRateLimiter {
  return new PgRateLimiter(c.db, {
    name,
    limit,
    windowMs,
    keySecret: requireEnv("SESSION_SECRET"),
  });
}

/**
 * D-073: when a looked-up artist is recognised, search for their upcoming gigs. Shares the
 * lookup's validator; capped at 20 searches a day across all clients to protect Tavily credits.
 */
function artistGigs(c: Container, validator: ArtistValidator) {
  const daily = pgLimiter(c, "lookup:gigs", 20, 86_400_000);
  const hook = artistGigLookup({
    discovery: c.gigs.discovery(createMemoryGigState(), { write: true }),
    validator,
    store: new PgEventCandidateRepository(c.db),
    clock: c.clock,
    logger: c.logger,
  });
  return {
    lookUp: async (a: { name: string; spotifyId: string }) =>
      (await daily.take("global", c.clock.now())) ? hook.lookUp(a) : 0,
  };
}

function buildLookup(c: Container): LiveLookup {
  const ev = c.events;
  const apiKey = env().TICKETMASTER_API_KEY;
  const validator = new ArtistValidator({
    catalog: c.spotify.artistCatalog,
    artists: ev.artistRepository,
    cache: createMemoryValidationCache(),
    clock: c.clock,
  });
  return new LiveLookup({
    catalog: c.spotify.artistCatalog,
    wikipedia: ev.collectorSources().wikipedia,
    ticketmaster: apiKey
      ? (keyword) => ev.ticketmasterSource({ apiKey, countryCodes: ["IN"], keyword })
      : null,
    validator,
    store: new PgEventCandidateRepository(c.db),
    // D-070: answers are shared across instances through Postgres.
    cache: new PgLookupCache(c.db, c.logger),
    ingest: ev.ingest,
    search: async (q) => {
      const r = await ev.suggest({ q });
      return "results" in r ? r.results : [];
    },
    resolvePendingArtists: (limit) => c.matching.resolvePendingArtists(limit),
    // Per client: 10 new lookups a minute. All clients together: 60 a minute.
    clientLimiter: pgLimiter(c, "lookup:client", 10, 60_000),
    globalLimiter: pgLimiter(c, "lookup:global", 60, 60_000),
    artistGigs: artistGigs(c, validator),
    clock: c.clock,
    logger: c.logger,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

function buildContainer(): Container {
  const base = { db: createDb(), logger, clock: systemClock, random: systemRandom };
  const c = base as Container;
  lazy(c, "spotify", () => spotifyFor(base));
  lazy(c, "engineSpotify", () =>
    spotifyFor(base, {
      http: PLAYLIST_STEP_SPOTIFY_HTTP,
      fetch: fetchWithTimeout((input, init) => fetch(input, init)),
    }),
  );
  lazy(c, "auth", () => {
    const s = c.spotify;
    return new SpotifyAuthService({
      oauth: s.oauth,
      profiles: s.profiles,
      users: s.users,
      sessions: s.sessions,
      tokens: s.tokens,
      clock: c.clock,
      newSessionId: s.newSessionId,
      adminSpotifyUserIds: env().ADMIN_SPOTIFY_USER_IDS.split(","),
    });
  });
  lazy(c, "events", () => createEventsModule(base));
  lazy(c, "matching", () => {
    const tavilyKey = env().TAVILY_API_KEY;
    return createMatchingModule({
      catalog: c.spotify.artistCatalog,
      tracks: c.spotify.trackCatalog,
      // D-025: matching also merges duplicates, which the events module's narrower type hides.
      artists: new PgArtistRepository(c.db),
      clock: c.clock,
      // D-016: the review queue survives restarts.
      candidateStore: new PgMatchCandidateStore(c.db, c.clock),
      // D-066: web corroboration only when a Tavily key is configured; otherwise hard cases go
      // to review. Band <-> member `relations` stays unwired until a MusicBrainz adapter exists.
      ...(tavilyKey
        ? {
            web: new TavilySearch({
              apiKey: tavilyKey,
              fetch: (input, init) => fetch(input, init),
            }),
          }
        : {}),
      eventLineups: eventLineups(c.events),
    });
  });
  lazy(c, "playlists", () =>
    createPlaylistsModule({
      db: c.db,
      clock: c.clock,
      logger: c.logger,
      trackCatalog: c.engineSpotify.trackCatalog,
      playlistWriter: c.engineSpotify.playlistWriter,
      events: c.events,
      users: c.engineSpotify.users,
      tokens: c.engineSpotify.tokens,
      lastfmApiKey: env().LASTFM_API_KEY,
      limiter: new PgStartLimiter(
        pgLimiter(c, "playlist:start", STARTS_PER_HOUR, 60 * 60_000),
        c.clock,
      ),
    }),
  );
  lazy(c, "lookup", () => buildLookup(c));
  lazy(c, "alerts", () => createAlerts({ env: env(), logger: c.logger }));
  lazy(c, "adminConsole", () => createAdminConsole(new PgAdminConsoleRepository(c.db)));
  lazy(c, "gigs", () =>
    createGigsModule({
      db: c.db,
      clock: c.clock,
      logger: c.logger,
      lastfmApiKey: env().LASTFM_API_KEY,
      tavilyApiKey: env().TAVILY_API_KEY,
      searchesPerDay: env().DOUBT_SEARCHES_PER_DAY,
      // The Gig Coverage team's own schema for its kill switch (D-073).
      autoPublishEnabled: GigEnvSchema.parse(process.env).AUTO_PUBLISH_ENABLED,
    }),
  );
  return c;
}

const holder = globalThis as typeof globalThis & { __lineupContainer?: Container };

export function container(): Container {
  holder.__lineupContainer ??= buildContainer();
  return holder.__lineupContainer;
}

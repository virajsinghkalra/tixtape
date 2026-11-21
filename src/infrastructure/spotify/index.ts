/**
 * Spotify module factory (D-014). The Lead wires this into src/server/container.ts.
 * Create it once per process: the rate limiter and app-token cache are per instance.
 */
import type {
  SessionRepository,
  SpotifyOAuth,
  SpotifyProfileReader,
  SpotifyTokenRepository,
  UserRepository,
} from "@/application/auth/ports";
import type { Clock, Random } from "@/application/ports/clock";
import type { ArtistCatalog, PlaylistWriter, TrackCatalog } from "@/application/ports/spotify";
import type { Database } from "@/db/client";
import { newSessionId } from "@/infrastructure/crypto/session-id";
import { TokenCipher } from "@/infrastructure/crypto/token-cipher";
import { PgSessionRepository } from "@/infrastructure/db/session-repository";
import { PgSpotifyGateStore } from "@/infrastructure/db/spotify-gate-store";
import { PgSpotifyTokenRepository } from "@/infrastructure/db/spotify-token-repository";
import { PgUserRepository } from "@/infrastructure/db/user-repository";
import { SpotifyAccessTokens } from "./access-tokens";
import { SpotifyArtistCatalog, SpotifyTrackCatalog } from "./catalog";
import { ArcticSpotifyOAuth } from "./oauth";
import { SpotifyPlaylistWriter } from "./playlist-writer";
import { SpotifyProfiles } from "./profiles";
import type { Sleep } from "./rate-limiter";
import { SpotifyHttp, type SpotifyHttpConfig } from "./spotify-http";

export type SpotifyModuleDeps = {
  db: Database;
  clock: Clock;
  random: Random;
  logger?: { warn(obj: object, msg: string): void };
  spotify: { clientId: string; clientSecret: string; redirectUri: string };
  /** TOKEN_ENC_KEY (base64, 32 bytes) and TOKEN_ENC_KEY_VERSION. */
  tokenEncryption: { key: string; version: number };
  fetch?: typeof fetch;
  sleep?: Sleep;
  http?: Partial<SpotifyHttpConfig>;
};

export type SpotifyModule = {
  http: SpotifyHttp;
  artistCatalog: ArtistCatalog;
  trackCatalog: TrackCatalog;
  playlistWriter: PlaylistWriter;
  oauth: SpotifyOAuth;
  profiles: SpotifyProfileReader;
  users: UserRepository;
  sessions: SessionRepository;
  tokens: SpotifyTokenRepository;
  newSessionId: () => string;
};

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createSpotifyModule(deps: SpotifyModuleDeps): SpotifyModule {
  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const cipher = new TokenCipher(
    { [deps.tokenEncryption.version]: deps.tokenEncryption.key },
    deps.tokenEncryption.version,
  );
  const tokens = new PgSpotifyTokenRepository(deps.db, cipher);
  const oauth = new ArcticSpotifyOAuth(deps.spotify, deps.clock, fetchFn);
  const http = new SpotifyHttp({
    fetch: fetchFn,
    clock: deps.clock,
    random: deps.random,
    sleep: deps.sleep ?? realSleep,
    gate: new PgSpotifyGateStore(deps.db),
    tokens: new SpotifyAccessTokens({ tokens, oauth, appTokens: oauth, clock: deps.clock }),
    logger: deps.logger,
    config: deps.http,
  });
  return {
    http,
    artistCatalog: new SpotifyArtistCatalog(http),
    trackCatalog: new SpotifyTrackCatalog(http),
    playlistWriter: new SpotifyPlaylistWriter(http),
    oauth,
    profiles: new SpotifyProfiles(http),
    users: new PgUserRepository(deps.db),
    sessions: new PgSessionRepository(deps.db),
    tokens,
    newSessionId,
  };
}

export { SpotifyHttp, DEFAULT_SPOTIFY_HTTP_CONFIG } from "./spotify-http";
export type {
  AccessTokenSource,
  SpotifyAuth,
  SpotifyHttpConfig,
  SpotifyRequest,
} from "./spotify-http";
export { SPOTIFY_SCOPES } from "./oauth";

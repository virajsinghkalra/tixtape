/**
 * Ports for Spotify sign-in and sessions (P1.2). Implemented in src/infrastructure/db/ and
 * src/infrastructure/spotify/; wired in src/server/container.ts.
 */
import type { UserId } from "@/domain/shared/ids";
import type { Result } from "@/lib/result";

export type UserRole = "user" | "admin";

export type AuthUser = {
  id: UserId;
  spotifyUserId: string;
  displayName: string | null;
  market: string;
  role: UserRole;
};

export interface UserRepository {
  /** Creates the user, or updates display name and role of the existing one. Keeps `market`. */
  upsertBySpotifyId(input: {
    spotifyUserId: string;
    displayName: string | null;
    role: UserRole;
  }): Promise<AuthUser>;
  findById(id: UserId): Promise<AuthUser | null>;
  /** Deletes the user; tokens, sessions, playlists and jobs cascade (LLD §4, D-070). */
  delete(id: UserId): Promise<void>;
}

export type ActiveSession = { userId: UserId; expiresAt: Date; createdAt: Date };

/** Stores only a SHA-256 hash of the session id (LLD §12). */
export interface SessionRepository {
  /** `createdAt` defaults to the database's now(); the service passes its clock's time. */
  create(sessionId: string, userId: UserId, expiresAt: Date, createdAt?: Date): Promise<void>;
  /** The session's user, or null when the session is unknown or expired at `now`. */
  findUserId(sessionId: string, now: Date): Promise<UserId | null>;
  /** Like findUserId, with the timestamps the idle timeout needs. */
  find(sessionId: string, now: Date): Promise<ActiveSession | null>;
  /** Moves the expiry (idle timeout, D-070). */
  extend(sessionId: string, expiresAt: Date): Promise<void>;
  delete(sessionId: string): Promise<void>;
  /** Deletes every session expired at `now`; returns how many. */
  deleteExpired(now: Date): Promise<number>;
}

export type SpotifyTokenSet = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
};

export type StoredSpotifyToken = SpotifyTokenSet & { userId: UserId; needsReauth: boolean };

/** Tokens are encrypted at rest (AES-256-GCM); this port deals in plaintext. */
export interface SpotifyTokenRepository {
  find(userId: UserId): Promise<StoredSpotifyToken | null>;
  /** Upserts the tokens and clears `needs_reauth`. */
  save(userId: UserId, tokens: SpotifyTokenSet): Promise<void>;
  markNeedsReauth(userId: UserId): Promise<void>;
  /** Runs `fn` in a transaction holding `pg_advisory_xact_lock` for this user (LLD §8.1). */
  withUserLock<T>(userId: UserId, fn: (tokens: SpotifyTokenRepository) => Promise<T>): Promise<T>;
}

export type AuthorizationRequest = { url: URL; state: string; codeVerifier: string };

/** Refresh result: Spotify may rotate the refresh token, or omit it (keep the old one). */
export type RefreshedTokens = Omit<SpotifyTokenSet, "refreshToken"> & {
  refreshToken: string | null;
};

export interface SpotifyOAuth {
  /** Authorization Code + PKCE (S256) + state, with the app's scopes. */
  beginAuthorization(): AuthorizationRequest;
  /** Throws UnauthorizedError when Spotify rejects the code. */
  exchangeCode(code: string, codeVerifier: string): Promise<SpotifyTokenSet>;
  refresh(refreshToken: string): Promise<Result<RefreshedTokens, "invalid_grant">>;
}

export interface SpotifyProfileReader {
  /** `GET /me` with a just-issued access token. */
  getCurrentUser(
    accessToken: string,
  ): Promise<{ spotifyUserId: string; displayName: string | null }>;
}

/**
 * Spotify sign-in and sessions (P1.2, LLD §8.1, §12). Routes call this through
 * src/server/auth; it never sees cookies or HTTP.
 */
import type { Clock } from "@/application/ports/clock";
import type { UserId } from "@/domain/shared/ids";
import { UnauthorizedError } from "@/lib/errors";
import type {
  ActiveSession,
  AuthorizationRequest,
  AuthUser,
  SessionRepository,
  SpotifyOAuth,
  SpotifyProfileReader,
  SpotifyTokenRepository,
  UserRepository,
  UserRole,
} from "./ports";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Absolute session lifetime (and the cookie's Max-Age). */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** A session ends after this long without use (D-070). */
export const SESSION_IDLE_TTL_MS = 14 * DAY_MS;
/** The idle expiry is pushed forward at most once per this interval, to limit writes. */
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;
/** Longer values can't be ours (we issue 43-char ids), so skip the DB lookup. */
const MAX_SESSION_ID_LENGTH = 128;

export type SpotifyAuthServiceDeps = {
  oauth: SpotifyOAuth;
  profiles: SpotifyProfileReader;
  users: UserRepository;
  sessions: SessionRepository;
  tokens: SpotifyTokenRepository;
  clock: Clock;
  newSessionId: () => string;
  adminSpotifyUserIds: readonly string[];
};

export type CompleteLoginInput = {
  code: string;
  state: string;
  /** From the short-lived state cookie; null when it's missing. */
  expectedState: string | null;
  /** From the short-lived verifier cookie; null when it's missing. */
  codeVerifier: string | null;
};

/** `expiresAt` is the absolute end (cookie lifetime); the server also ends idle sessions. */
export type StartedSession = { sessionId: string; expiresAt: Date; user: AuthUser };

export class SpotifyAuthService {
  private readonly admins: ReadonlySet<string>;

  constructor(private readonly deps: SpotifyAuthServiceDeps) {
    this.admins = new Set(deps.adminSpotifyUserIds.map((id) => id.trim()).filter(Boolean));
  }

  startLogin(): AuthorizationRequest {
    return this.deps.oauth.beginAuthorization();
  }

  async completeLogin(input: CompleteLoginInput): Promise<StartedSession> {
    const { expectedState, codeVerifier } = input;
    if (!expectedState || !codeVerifier || input.state !== expectedState) {
      throw new UnauthorizedError("Sign-in expired or didn't match. Please try again.");
    }
    const tokens = await this.deps.oauth.exchangeCode(input.code, codeVerifier);
    const profile = await this.deps.profiles.getCurrentUser(tokens.accessToken);
    const user = await this.deps.users.upsertBySpotifyId({
      ...profile,
      role: this.roleFor(profile.spotifyUserId),
    });
    await this.deps.tokens.save(user.id, tokens);

    const sessionId = this.deps.newSessionId();
    const now = this.deps.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.deps.sessions.create(sessionId, user.id, idleExpiry(now, now), now);
    return { sessionId, expiresAt, user };
  }

  /** The signed-in user, or null. The admin role always reflects ADMIN_SPOTIFY_USER_IDS now. */
  async getSessionUser(sessionId: string): Promise<AuthUser | null> {
    if (sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH) return null;
    const now = this.deps.clock.now();
    const session = await this.deps.sessions.find(sessionId, now);
    if (!session) return null;
    const user = await this.deps.users.findById(session.userId);
    if (!user) return null;
    await this.touch(sessionId, session, now);
    return { ...user, role: this.roleFor(user.spotifyUserId) };
  }

  /** Deletes the user and, by cascade, their tokens, sessions and playlists (D-070). */
  async deleteAccount(userId: UserId): Promise<void> {
    await this.deps.users.delete(userId);
  }

  /** For the scheduled sweep. Returns how many sessions were removed. */
  deleteExpiredSessions(): Promise<number> {
    return this.deps.sessions.deleteExpired(this.deps.clock.now());
  }

  /** Slides the idle expiry, capped at the absolute lifetime; writes at most once a day. */
  private async touch(sessionId: string, session: ActiveSession, now: Date): Promise<void> {
    const target = idleExpiry(now, session.createdAt);
    if (target.getTime() - session.expiresAt.getTime() >= SESSION_TOUCH_INTERVAL_MS) {
      await this.deps.sessions.extend(sessionId, target);
    }
  }

  async logout(sessionId: string): Promise<void> {
    if (sessionId === "" || sessionId.length > MAX_SESSION_ID_LENGTH) return;
    await this.deps.sessions.delete(sessionId);
  }

  private roleFor(spotifyUserId: string): UserRole {
    return this.admins.has(spotifyUserId) ? "admin" : "user";
  }
}

function idleExpiry(now: Date, createdAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + SESSION_IDLE_TTL_MS, createdAt.getTime() + SESSION_TTL_MS),
  );
}

/**
 * Access tokens for SpotifyHttp (LLD §8.1). User tokens come from the encrypted store and are
 * refreshed under a per-user advisory lock; the app token (client credentials) lives in memory.
 */
import type { Clock } from "@/application/ports/clock";
import type {
  SpotifyOAuth,
  SpotifyTokenRepository,
  StoredSpotifyToken,
} from "@/application/auth/ports";
import { ReauthRequiredError, type SpotifyCaller } from "@/application/ports/spotify";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { err, ok, type Result } from "@/lib/result";
import type { AccessTokenSource } from "./spotify-http";

/** Reuse a token only while it has more than this left. */
const MIN_REMAINING_MS = 60_000;

export type AppToken = { accessToken: string; expiresAt: Date };

export interface AppTokenClient {
  /** Client-credentials grant. */
  clientCredentials(): Promise<AppToken>;
}

export type SpotifyAccessTokensDeps = {
  tokens: SpotifyTokenRepository;
  oauth: Pick<SpotifyOAuth, "refresh">;
  appTokens: AppTokenClient;
  clock: Clock;
};

export class SpotifyAccessTokens implements AccessTokenSource {
  private appToken: AppToken | null = null;
  private appTokenPending: Promise<AppToken> | null = null;

  constructor(private readonly deps: SpotifyAccessTokensDeps) {}

  async get(caller: SpotifyCaller, opts?: { rejected?: string }): Promise<string> {
    if (caller.kind === "app") return this.getAppToken(opts?.rejected);
    return this.getUserToken(asUserId(caller.userId), opts?.rejected);
  }

  private async getUserToken(userId: UserId, rejected?: string): Promise<string> {
    const stored = await this.deps.tokens.find(userId);
    if (!stored || stored.needsReauth) throw new ReauthRequiredError();
    if (this.usable(stored, rejected)) return stored.accessToken;

    const outcome = await this.deps.tokens.withUserLock(userId, (locked) =>
      this.refreshLocked(locked, userId, rejected),
    );
    // Thrown only after the transaction commits, so `needs_reauth` is persisted.
    if (!outcome.ok) throw new ReauthRequiredError();
    return outcome.value;
  }

  private async refreshLocked(
    tokens: SpotifyTokenRepository,
    userId: UserId,
    rejected?: string,
  ): Promise<Result<string, "reauth">> {
    // Re-read under the lock: another process may have refreshed already.
    const stored = await tokens.find(userId);
    if (!stored || stored.needsReauth) return err("reauth");
    if (this.usable(stored, rejected)) return ok(stored.accessToken);

    const refreshed = await this.deps.oauth.refresh(stored.refreshToken);
    if (!refreshed.ok) {
      await tokens.markNeedsReauth(userId);
      return err("reauth");
    }
    const next = refreshed.value;
    await tokens.save(userId, {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? stored.refreshToken,
      scope: next.scope || stored.scope,
      expiresAt: next.expiresAt,
    });
    return ok(next.accessToken);
  }

  private usable(stored: StoredSpotifyToken, rejected?: string): boolean {
    return stored.accessToken !== rejected && this.fresh(stored.expiresAt);
  }

  private fresh(expiresAt: Date): boolean {
    return expiresAt.getTime() - this.deps.clock.now().getTime() > MIN_REMAINING_MS;
  }

  private async getAppToken(rejected?: string): Promise<string> {
    const cached = this.appToken;
    if (cached && cached.accessToken !== rejected && this.fresh(cached.expiresAt)) {
      return cached.accessToken;
    }
    // One in-flight request per process, however many callers need a token at once.
    this.appTokenPending ??= this.deps.appTokens.clientCredentials().finally(() => {
      this.appTokenPending = null;
    });
    this.appToken = await this.appTokenPending;
    return this.appToken.accessToken;
  }
}

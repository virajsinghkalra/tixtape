import { describe, expect, it, vi } from "vitest";
import type {
  RefreshedTokens,
  SpotifyTokenRepository,
  SpotifyTokenSet,
  StoredSpotifyToken,
} from "@/application/auth/ports";
import { ReauthRequiredError } from "@/application/ports/spotify";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { err, ok, type Result } from "@/lib/result";
import { SpotifyAccessTokens, type AppToken } from "./access-tokens";
import { FakeClock, T0 } from "./test-support";

const USER = asUserId("user-1");
const caller = { kind: "user", userId: USER } as const;

class MemoryTokenRepo implements SpotifyTokenRepository {
  rows = new Map<UserId, StoredSpotifyToken>();
  locks = 0;
  /** Runs inside the lock before `fn`, to simulate another process. */
  onLock: (() => void) | null = null;
  async find(userId: UserId) {
    return this.rows.get(userId) ?? null;
  }
  async save(userId: UserId, tokens: SpotifyTokenSet) {
    this.rows.set(userId, { ...tokens, userId, needsReauth: false });
  }
  async markNeedsReauth(userId: UserId) {
    const row = this.rows.get(userId);
    if (row) this.rows.set(userId, { ...row, needsReauth: true });
  }
  async withUserLock<T>(
    _userId: UserId,
    fn: (r: SpotifyTokenRepository) => Promise<T>,
  ): Promise<T> {
    this.locks++;
    this.onLock?.();
    return fn(this);
  }
}

function setup(expiresInMs: number, extra: Partial<StoredSpotifyToken> = {}) {
  const clock = new FakeClock();
  const repo = new MemoryTokenRepo();
  repo.rows.set(USER, {
    userId: USER,
    accessToken: "old-access",
    refreshToken: "old-refresh",
    scope: "playlist-modify-private",
    expiresAt: new Date(T0 + expiresInMs),
    needsReauth: false,
    ...extra,
  });
  const refresh = vi.fn(async (_rt: string): Promise<Result<RefreshedTokens, "invalid_grant">> =>
    ok({
      accessToken: "new-access",
      refreshToken: null,
      scope: "",
      expiresAt: new Date(T0 + 3_600_000),
    }),
  );
  const clientCredentials = vi.fn(async (): Promise<AppToken> => ({
    accessToken: "app-1",
    expiresAt: new Date(clock.ms + 3_600_000),
  }));
  const tokens = new SpotifyAccessTokens({
    tokens: repo,
    oauth: { refresh },
    appTokens: { clientCredentials },
    clock,
  });
  return { clock, repo, refresh, clientCredentials, tokens };
}

describe("SpotifyAccessTokens (user)", () => {
  it("reuses a token with more than 60s left, without locking", async () => {
    const { tokens, refresh, repo } = setup(61_000);
    await expect(tokens.get(caller)).resolves.toBe("old-access");
    expect(refresh).not.toHaveBeenCalled();
    expect(repo.locks).toBe(0);
  });

  it("refreshes under the lock when 60s or less is left, keeping the old refresh token", async () => {
    const { tokens, refresh, repo } = setup(60_000);
    await expect(tokens.get(caller)).resolves.toBe("new-access");
    expect(refresh).toHaveBeenCalledWith("old-refresh");
    expect(repo.locks).toBe(1);
    expect(repo.rows.get(USER)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "old-refresh",
      scope: "playlist-modify-private",
      expiresAt: new Date(T0 + 3_600_000),
    });
  });

  it("stores a rotated refresh token", async () => {
    const { tokens, refresh, repo } = setup(0);
    refresh.mockResolvedValueOnce(
      ok({
        accessToken: "a2",
        refreshToken: "r2",
        scope: "s2",
        expiresAt: new Date(T0 + 1000_000),
      }),
    );
    await tokens.get(caller);
    expect(repo.rows.get(USER)).toMatchObject({ refreshToken: "r2", scope: "s2" });
  });

  it("marks needs_reauth and throws ReauthRequiredError on invalid_grant", async () => {
    const { tokens, refresh, repo } = setup(0);
    refresh.mockResolvedValueOnce(err("invalid_grant"));
    await expect(tokens.get(caller)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(repo.rows.get(USER)?.needsReauth).toBe(true);
  });

  it("throws ReauthRequiredError without calling Spotify when reauth is already needed", async () => {
    const { tokens, refresh } = setup(3_600_000, { needsReauth: true });
    await expect(tokens.get(caller)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("throws ReauthRequiredError for a user with no stored tokens", async () => {
    const { tokens } = setup(3_600_000);
    await expect(tokens.get({ kind: "user", userId: "someone-else" })).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
  });

  it("refreshes a fresh-looking token that Spotify rejected", async () => {
    const { tokens, refresh } = setup(3_600_000);
    await expect(tokens.get(caller, { rejected: "old-access" })).resolves.toBe("new-access");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("uses a token another process refreshed while we waited for the lock", async () => {
    const { tokens, refresh, repo } = setup(0);
    repo.onLock = () => {
      const row = repo.rows.get(USER)!;
      repo.rows.set(USER, { ...row, accessToken: "theirs", expiresAt: new Date(T0 + 3_600_000) });
    };
    await expect(tokens.get(caller)).resolves.toBe("theirs");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SpotifyAccessTokens (app)", () => {
  it("caches the client-credentials token until 60s before expiry", async () => {
    const { tokens, clientCredentials, clock } = setup(0);
    await expect(tokens.get({ kind: "app" })).resolves.toBe("app-1");
    clock.advance(3_540_000 - 1);
    await tokens.get({ kind: "app" });
    expect(clientCredentials).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await tokens.get({ kind: "app" });
    expect(clientCredentials).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const { tokens, clientCredentials } = setup(0);
    await Promise.all([tokens.get({ kind: "app" }), tokens.get({ kind: "app" })]);
    expect(clientCredentials).toHaveBeenCalledTimes(1);
  });

  it("fetches a new token when the cached one was rejected", async () => {
    const { tokens, clientCredentials } = setup(0);
    await tokens.get({ kind: "app" });
    await tokens.get({ kind: "app" }, { rejected: "app-1" });
    expect(clientCredentials).toHaveBeenCalledTimes(2);
  });
});

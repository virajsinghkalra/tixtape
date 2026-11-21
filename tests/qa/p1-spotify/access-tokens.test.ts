import { describe, expect, it } from "vitest";
import type { RefreshedTokens } from "@/application/auth/ports";
import { ReauthRequiredError } from "@/application/ports/spotify";
import { asUserId } from "@/domain/shared/ids";
import { SpotifyAccessTokens } from "@/infrastructure/spotify/access-tokens";
import { err, ok, type Result } from "@/lib/result";
import { FakeClock, MemTokens, T0 } from "./fakes";

const U = asUserId("00000000-0000-4000-8000-000000000001");

function rig(expiresInMs: number, opts: { needsReauth?: boolean; none?: boolean } = {}) {
  const clock = new FakeClock();
  const tokens = new MemTokens();
  if (!opts.none)
    tokens.rows.set(U, {
      userId: U,
      accessToken: "old-access",
      refreshToken: "old-refresh",
      scope: "playlist-modify-private",
      expiresAt: new Date(T0 + expiresInMs),
      needsReauth: opts.needsReauth ?? false,
    });
  const refreshCalls: string[] = [];
  let next: () => Promise<Result<RefreshedTokens, "invalid_grant">> = async () =>
    ok({
      accessToken: `new-access-${refreshCalls.length}`,
      refreshToken: "rotated-refresh",
      scope: "playlist-modify-private",
      expiresAt: new Date(clock.t + 3_600_000),
    });
  let appCalls = 0;
  const svc = new SpotifyAccessTokens({
    tokens,
    clock,
    oauth: {
      refresh: async (rt) => {
        refreshCalls.push(rt);
        return next();
      },
    },
    appTokens: {
      clientCredentials: async () => {
        appCalls++;
        return { accessToken: `app-${appCalls}`, expiresAt: new Date(clock.t + 3_600_000) };
      },
    },
  });
  return {
    clock,
    tokens,
    svc,
    refreshCalls,
    appCalls: () => appCalls,
    setRefresh: (f: typeof next) => (next = f),
  };
}
const user = { kind: "user" as const, userId: U };

describe("QA user access tokens (LLD §8.1)", () => {
  it("valid for > 60s: returned as-is, no refresh", async () => {
    const r = rig(61_000);
    await expect(r.svc.get(user)).resolves.toBe("old-access");
    expect(r.refreshCalls).toHaveLength(0);
  });

  it.each([59_000, 1_000, 0, -10_000])("valid for %ims (< 60s): refreshed", async (ms) => {
    const r = rig(ms);
    await expect(r.svc.get(user)).resolves.toBe("new-access-1");
    expect(r.refreshCalls).toEqual(["old-refresh"]);
  });

  it("refresh happens under the per-user lock", async () => {
    const r = rig(1_000);
    await r.svc.get(user);
    expect(r.tokens.lockCalls).toBeGreaterThanOrEqual(1);
  });

  it("stores the rotated refresh token", async () => {
    const r = rig(1_000);
    await r.svc.get(user);
    expect(r.tokens.saves.at(-1)!.tokens).toMatchObject({
      accessToken: "new-access-1",
      refreshToken: "rotated-refresh",
    });
    expect((await r.tokens.find(U))!.refreshToken).toBe("rotated-refresh");
  });

  it("keeps the old refresh token when Spotify omits it", async () => {
    const r = rig(1_000);
    r.setRefresh(async () =>
      ok({ accessToken: "n", refreshToken: null, scope: "s", expiresAt: new Date(T0 + 3_600_000) }),
    );
    await r.svc.get(user);
    expect(r.tokens.saves.at(-1)!.tokens.refreshToken).toBe("old-refresh");
  });

  it("invalid_grant → needs_reauth set + ReauthRequiredError", async () => {
    const r = rig(1_000);
    r.setRefresh(async () => err("invalid_grant"));
    await expect(r.svc.get(user)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(r.tokens.reauthMarks).toEqual([U]);
    expect(r.tokens.saves).toHaveLength(0);
  });

  it("no stored tokens → ReauthRequiredError, no refresh", async () => {
    const r = rig(0, { none: true });
    await expect(r.svc.get(user)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(r.refreshCalls).toHaveLength(0);
  });

  it("needs_reauth already set → ReauthRequiredError without calling Spotify, even if token looks valid", async () => {
    const r = rig(3_000_000, { needsReauth: true });
    await expect(r.svc.get(user)).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(r.refreshCalls).toHaveLength(0);
  });

  it("a transient refresh failure does NOT mark needs_reauth", async () => {
    const r = rig(1_000);
    r.setRefresh(async () => {
      throw new Error("network down");
    });
    await expect(r.svc.get(user)).rejects.toBeTruthy();
    expect(r.tokens.reauthMarks).toHaveLength(0);
  });

  it("rejected: a valid-looking token that Spotify 401'd is refreshed", async () => {
    const r = rig(3_000_000);
    await expect(r.svc.get(user, { rejected: "old-access" })).resolves.toBe("new-access-1");
  });

  it("rejected: if another worker already refreshed, use the new token without refreshing again", async () => {
    const r = rig(3_000_000);
    r.tokens.onLock = () => {
      const row = r.tokens.rows.get(U)!;
      r.tokens.rows.set(U, { ...row, accessToken: "other-worker-access" });
    };
    await expect(r.svc.get(user, { rejected: "old-access" })).resolves.toBe("other-worker-access");
    expect(r.refreshCalls).toHaveLength(0);
  });

  it("double-checked lock: if the token was refreshed while waiting for the lock, no second refresh", async () => {
    const r = rig(1_000);
    r.tokens.onLock = () => {
      const row = r.tokens.rows.get(U)!;
      r.tokens.rows.set(U, { ...row, accessToken: "fresh", expiresAt: new Date(T0 + 3_600_000) });
    };
    await expect(r.svc.get(user)).resolves.toBe("fresh");
    expect(r.refreshCalls).toHaveLength(0);
  });

  it("concurrent gets for one user in one process → a single refresh", async () => {
    const r = rig(1_000);
    const out = await Promise.all([r.svc.get(user), r.svc.get(user), r.svc.get(user)]);
    expect(r.refreshCalls).toHaveLength(1);
    expect(new Set(out)).toEqual(new Set(["new-access-1"]));
  });
});

describe("QA app (client-credentials) tokens", () => {
  it("is cached while valid", async () => {
    const r = rig(0);
    await r.svc.get({ kind: "app" });
    await r.svc.get({ kind: "app" });
    expect(r.appCalls()).toBe(1);
  });

  it("is renewed near expiry", async () => {
    const r = rig(0);
    await r.svc.get({ kind: "app" });
    r.clock.t += 3_600_000 - 30_000;
    await expect(r.svc.get({ kind: "app" })).resolves.toBe("app-2");
  });

  it("concurrent first gets share one client-credentials call", async () => {
    const r = rig(0);
    await Promise.all([r.svc.get({ kind: "app" }), r.svc.get({ kind: "app" })]);
    expect(r.appCalls()).toBe(1);
  });

  it("rejected app token is replaced", async () => {
    const r = rig(0);
    const a = await r.svc.get({ kind: "app" });
    await expect(r.svc.get({ kind: "app" }, { rejected: a })).resolves.toBe("app-2");
  });
});

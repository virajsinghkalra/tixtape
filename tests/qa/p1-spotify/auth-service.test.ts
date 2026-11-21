import { describe, expect, it } from "vitest";
import type { SpotifyOAuth, SpotifyProfileReader } from "@/application/auth/ports";
import { SESSION_TTL_MS, SpotifyAuthService } from "@/application/auth/spotify-auth-service";
import { isAppError, UnauthorizedError } from "@/lib/errors";
import { ok } from "@/lib/result";
import { FakeClock, MemSessions, MemTokens, MemUsers, T0, dump } from "./fakes";

function rig(opts: { admins?: string[]; profileId?: string; exchangeFails?: boolean } = {}) {
  const clock = new FakeClock();
  const users = new MemUsers();
  const sessions = new MemSessions();
  const tokens = new MemTokens();
  const exchanges: { code: string; verifier: string }[] = [];
  let sid = 0;
  const oauth: SpotifyOAuth = {
    beginAuthorization: () => ({
      url: new URL("https://accounts.spotify.com/authorize?state=S"),
      state: "S",
      codeVerifier: "V",
    }),
    exchangeCode: async (code, verifier) => {
      exchanges.push({ code, verifier });
      if (opts.exchangeFails) throw new UnauthorizedError("Spotify rejected the code");
      return {
        accessToken: "AT-SECRET",
        refreshToken: "RT-SECRET",
        scope: "playlist-modify-private",
        expiresAt: new Date(T0 + 3_600_000),
      };
    },
    refresh: async () =>
      ok({ accessToken: "x", refreshToken: null, scope: "", expiresAt: new Date() }),
  };
  const profileTokens: string[] = [];
  const profiles: SpotifyProfileReader = {
    getCurrentUser: async (t) => {
      profileTokens.push(t);
      return { spotifyUserId: opts.profileId ?? "alice", displayName: "Alice" };
    },
  };
  const svc = new SpotifyAuthService({
    oauth,
    profiles,
    users,
    sessions,
    tokens,
    clock,
    newSessionId: () => `sid-${++sid}`,
    adminSpotifyUserIds: opts.admins ?? [],
  });
  return { svc, clock, users, sessions, tokens, exchanges, profileTokens, oauth };
}

const good = { code: "C", state: "S", expectedState: "S", codeVerifier: "V" };

async function rejects(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  expect(isAppError(e)).toBe(true);
  return e;
}

describe("QA SpotifyAuthService.completeLogin", () => {
  it("happy path: exchanges, reads profile, stores tokens, creates a 30-day session", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    expect(r.exchanges).toEqual([{ code: "C", verifier: "V" }]);
    expect(r.profileTokens).toEqual(["AT-SECRET"]);
    expect(s.user.spotifyUserId).toBe("alice");
    expect(s.user.role).toBe("user");
    expect(s.sessionId).toBe("sid-1");
    expect(s.expiresAt.getTime()).toBe(T0 + SESSION_TTL_MS);
    expect(r.sessions.rows.get("sid-1")!.userId).toBe(s.user.id);
    expect(r.tokens.rows.get(s.user.id)).toMatchObject({
      accessToken: "AT-SECRET",
      refreshToken: "RT-SECRET",
    });
  });

  it("returned session does not carry the Spotify tokens", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    expect(dump(s)).not.toMatch(/AT-SECRET|RT-SECRET/);
  });

  it.each([
    ["state mismatch", { ...good, state: "EVIL" }],
    ["expected state missing", { ...good, expectedState: null }],
    ["verifier missing", { ...good, codeVerifier: null }],
    ["both empty state", { ...good, state: "", expectedState: "" }],
    ["state differs by case", { ...good, state: "s" }],
    ["state prefix", { ...good, state: "S", expectedState: "S2" }],
  ])("%s → rejected before exchanging the code", async (_n, input) => {
    const r = rig();
    await rejects(r.svc.completeLogin(input));
    expect(r.exchanges).toHaveLength(0);
    expect(r.sessions.rows.size).toBe(0);
  });

  it("empty verifier is rejected", async () => {
    const r = rig();
    await rejects(r.svc.completeLogin({ ...good, codeVerifier: "" }));
    expect(r.exchanges).toHaveLength(0);
  });

  it("rejected code → error, no user/session/tokens written", async () => {
    const r = rig({ exchangeFails: true });
    await rejects(r.svc.completeLogin(good));
    expect(r.users.rows.size).toBe(0);
    expect(r.sessions.rows.size).toBe(0);
    expect(r.tokens.saves).toHaveLength(0);
  });

  it("admin only for ids in ADMIN_SPOTIFY_USER_IDS (exact match)", async () => {
    expect((await rig({ admins: ["alice"] }).svc.completeLogin(good)).user.role).toBe("admin");
    expect((await rig({ admins: ["Alice"] }).svc.completeLogin(good)).user.role).toBe("user");
    expect((await rig({ admins: ["alic"] }).svc.completeLogin(good)).user.role).toBe("user");
    expect((await rig({ admins: [""] }).svc.completeLogin(good)).user.role).toBe("user");
  });

  it("a user removed from the admin list is demoted on next login", async () => {
    const r = rig({ admins: ["alice"] });
    const first = await r.svc.completeLogin(good);
    expect(first.user.role).toBe("admin");
    const r2 = new SpotifyAuthService({
      oauth: r.oauth,
      profiles: { getCurrentUser: async () => ({ spotifyUserId: "alice", displayName: "A" }) },
      users: r.users,
      sessions: r.sessions,
      tokens: r.tokens,
      clock: r.clock,
      newSessionId: () => "sid-x",
      adminSpotifyUserIds: [],
    });
    expect((await r2.completeLogin(good)).user.role).toBe("user");
  });

  it("re-login stores the new tokens and clears needs_reauth", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    await r.tokens.markNeedsReauth(s.user.id);
    await r.svc.completeLogin(good);
    expect(r.tokens.rows.get(s.user.id)!.needsReauth).toBe(false);
  });

  it("each login gets a distinct session id", async () => {
    const r = rig();
    const a = await r.svc.completeLogin(good);
    const b = await r.svc.completeLogin(good);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe("QA SpotifyAuthService sessions", () => {
  it("getSessionUser returns the user while valid, null once expired (uses the clock)", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    expect((await r.svc.getSessionUser(s.sessionId))?.id).toBe(s.user.id);
    r.clock.t = T0 + SESSION_TTL_MS + 1;
    expect(await r.svc.getSessionUser(s.sessionId)).toBeNull();
    expect(r.sessions.nowsSeen.at(-1)!.getTime()).toBe(T0 + SESSION_TTL_MS + 1);
  });

  it("unknown / empty session → null", async () => {
    const r = rig();
    expect(await r.svc.getSessionUser("nope")).toBeNull();
    expect(await r.svc.getSessionUser("")).toBeNull();
  });

  it("session whose user was deleted → null", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    r.users.rows.clear();
    expect(await r.svc.getSessionUser(s.sessionId)).toBeNull();
  });

  it("logout deletes the session; logging out twice is harmless", async () => {
    const r = rig();
    const s = await r.svc.completeLogin(good);
    await r.svc.logout(s.sessionId);
    expect(await r.svc.getSessionUser(s.sessionId)).toBeNull();
    await expect(r.svc.logout(s.sessionId)).resolves.toBeUndefined();
  });

  it("startLogin delegates to OAuth (state + verifier)", () => {
    const a = rig().svc.startLogin();
    expect(a.state).toBe("S");
    expect(a.codeVerifier).toBe("V");
  });
});

import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyOAuth } from "@/application/auth/ports";
import { asUserId } from "@/domain/shared/ids";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { ok } from "@/lib/result";
import { FakeClock, MemSessions, MemTokens, MemUsers, T0 } from "./fakes";

const st = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused/qa";
  process.env.SPOTIFY_CLIENT_ID = "qa-client";
  process.env.SPOTIFY_CLIENT_SECRET = "qa-secret";
  process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.ADMIN_SPOTIFY_USER_IDS = " alice ,bob";
  process.env.APP_URL = "http://127.0.0.1:3000";
  return {
    profileId: "alice",
    exchange: null as null | (() => Promise<never>),
    exchanges: 0,
    sid: 0,
    clock: null as unknown,
    users: null as unknown,
    sessions: null as unknown,
    tokens: null as unknown,
  };
});

vi.mock("@/server/container", async () => {
  // The real logger: we capture what it writes.
  const { logger } = await import("@/lib/logger");
  // The routes reach auth through container().spotify / container().auth; wire them the way
  // the real container does, from the mocked Spotify module below.
  const { createSpotifyModule } = await import("@/infrastructure/spotify");
  const { SpotifyAuthService } = await import("@/application/auth/spotify-auth-service");
  let built: object | null = null;
  return {
    container: () => {
      if (built) return built;
      const spotify = createSpotifyModule({} as never);
      const auth = new SpotifyAuthService({
        oauth: spotify.oauth,
        profiles: spotify.profiles,
        users: spotify.users,
        sessions: spotify.sessions,
        tokens: spotify.tokens,
        clock: st.clock as never,
        newSessionId: spotify.newSessionId,
        adminSpotifyUserIds: (process.env.ADMIN_SPOTIFY_USER_IDS ?? "").split(","),
      });
      built = { db: {}, clock: st.clock, random: { next: () => 0.5 }, logger, spotify, auth };
      return built;
    },
  };
});

vi.mock("@/infrastructure/spotify", () => {
  const oauth: SpotifyOAuth = {
    beginAuthorization: () => ({
      url: new URL("https://accounts.spotify.com/authorize?state=STATE123&code_challenge=x"),
      state: "STATE123",
      codeVerifier: "VERIFIER-SECRET-abcdefghijklmnopqrstuvwxyz0123456789",
    }),
    exchangeCode: async () => {
      st.exchanges++;
      if (st.exchange) return st.exchange();
      return {
        accessToken: "AT-SECRET-123",
        refreshToken: "RT-SECRET-456",
        scope: "playlist-modify-private",
        expiresAt: new Date(T0 + 3_600_000),
      };
    },
    refresh: async () =>
      ok({ accessToken: "x", refreshToken: null, scope: "", expiresAt: new Date() }),
  };
  return {
    createSpotifyModule: () => ({
      oauth,
      profiles: { getCurrentUser: async () => ({ spotifyUserId: st.profileId, displayName: "Q" }) },
      get users() {
        return st.users;
      },
      get sessions() {
        return st.sessions;
      },
      get tokens() {
        return st.tokens;
      },
      newSessionId: () => `raw-session-${++st.sid}-xxxxxxxxxxxxxxxx`,
    }),
  };
});

const { logger } = await import("@/lib/logger");
const { GET: login } = await import("@/app/api/auth/spotify/login/route");
const { GET: callback } = await import("@/app/api/auth/spotify/callback/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { requireUser, requireAdmin } = await import("@/server/auth/guards");
const cookies = await import("@/server/auth/cookies");

// Stable singletons (the app caches the auth service), reset per test.
const users = new MemUsers();
const sessions = new MemSessions();
const tokens = new MemTokens();
const clock = new FakeClock();
st.users = users;
st.sessions = sessions;
st.tokens = tokens;
st.clock = clock;

let logs = "";
beforeEach(() => {
  users.rows.clear();
  sessions.rows.clear();
  tokens.rows.clear();
  clock.t = T0;
  st.profileId = "alice";
  st.exchange = null;
  st.exchanges = 0;
  logs = "";
  const cap = (chunk: unknown) => {
    logs += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString();
  };
  vi.spyOn(fs, "writeSync").mockImplementation(((_fd: number, chunk: unknown) => {
    cap(chunk);
    return typeof chunk === "string" ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length;
  }) as never);
  vi.spyOn(fs, "write").mockImplementation(((_fd: number, chunk: unknown, ...rest: unknown[]) => {
    cap(chunk);
    const cb = rest.find((r) => typeof r === "function") as
      ((e: null, n: number) => void) | undefined;
    cb?.(null, typeof chunk === "string" ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length);
  }) as never);
  vi.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => {
    cap(c);
    return true;
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

const ctx = undefined as never;
const setCookies = (r: Response) => r.headers.getSetCookie();
const cookieFor = (r: Response, name: string) =>
  setCookies(r).find((c) => c.startsWith(`${name}=`));
const attrs = (c: string) => c.split(";").map((p) => p.trim().toLowerCase());

function cb(query: string, cookie: string) {
  return callback(
    new Request(`http://127.0.0.1:3000/api/auth/spotify/callback${query}`, { headers: { cookie } }),
    ctx,
  );
}
const oauthCookie = `${cookies.OAUTH_STATE_COOKIE}=STATE123; ${cookies.OAUTH_VERIFIER_COOKIE}=VERIFIER-SECRET-abcdefghijklmnopqrstuvwxyz0123456789`;

async function signIn(profileId = "alice") {
  st.profileId = profileId;
  const res = await cb("?code=CODE&state=STATE123", oauthCookie);
  const c = cookieFor(res, cookies.SESSION_COOKIE)!;
  return { res, sessionValue: c.split(";")[0]!.split("=").slice(1).join("=") };
}
const withSession = (v: string) =>
  new Request("http://127.0.0.1:3000/api/x", {
    headers: { cookie: `${cookies.SESSION_COOKIE}=${v}` },
  });

describe("QA GET /api/auth/spotify/login", () => {
  it("redirects to Spotify and sets httpOnly, SameSite=Lax state+verifier cookies (no Secure on 127.0.0.1 dev)", async () => {
    const res = await login(new Request("http://127.0.0.1:3000/api/auth/spotify/login"), ctx);
    expect([302, 303, 307]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize/);
    for (const name of [cookies.OAUTH_STATE_COOKIE, cookies.OAUTH_VERIFIER_COOKIE]) {
      const c = cookieFor(res, name)!;
      expect(c).toBeTruthy();
      const a = attrs(c);
      expect(a).toContain("httponly");
      expect(a).toContain("samesite=lax");
      expect(a).not.toContain("secure");
      const maxAge = a.find((x) => x.startsWith("max-age="));
      expect(maxAge && Number(maxAge.split("=")[1])).toBeGreaterThan(0);
    }
    expect(await res.text()).not.toContain("VERIFIER-SECRET");
  });
});

describe("QA GET /api/auth/spotify/callback", () => {
  it("success: session cookie httpOnly/Lax/Path=/, oauth cookies cleared, no tokens in body or logs", async () => {
    const res = await cb("?code=CODE&state=STATE123", oauthCookie);
    expect(res.status).toBeLessThan(400);
    const s = cookieFor(res, cookies.SESSION_COOKIE)!;
    const a = attrs(s);
    expect(a).toContain("httponly");
    expect(a).toContain("samesite=lax");
    expect(a).toContain("path=/");
    expect(a).not.toContain("secure");
    expect(Number(a.find((x) => x.startsWith("max-age="))!.split("=")[1])).toBeGreaterThan(0);
    for (const n of [cookies.OAUTH_STATE_COOKIE, cookies.OAUTH_VERIFIER_COOKIE]) {
      expect(attrs(cookieFor(res, n)!)).toContain("max-age=0");
    }
    const body = await res.text();
    const all = body + JSON.stringify([...res.headers]) + logs;
    expect(all).not.toMatch(/AT-SECRET-123|RT-SECRET-456/);
    expect(sessions.rows.size).toBe(1);
  });

  it.each([
    ["state mismatch", "?code=CODE&state=OTHER", oauthCookie],
    ["no state cookie", "?code=CODE&state=STATE123", `${cookies.OAUTH_VERIFIER_COOKIE}=v`],
    ["no verifier cookie", "?code=CODE&state=STATE123", `${cookies.OAUTH_STATE_COOKIE}=STATE123`],
    ["no cookies", "?code=CODE&state=STATE123", ""],
    ["missing code", "?state=STATE123", oauthCookie],
    ["missing state", "?code=CODE", oauthCookie],
    [
      "empty state both sides",
      "?code=CODE&state=",
      `${cookies.OAUTH_STATE_COOKIE}=; ${cookies.OAUTH_VERIFIER_COOKIE}=v`,
    ],
  ])("%s → rejected, no session, no code exchange, not a 5xx", async (_n, q, cookie) => {
    const res = await cb(q, cookie);
    expect(res.status).toBeLessThan(500);
    expect(cookieFor(res, cookies.SESSION_COOKIE) ?? "").not.toMatch(/^session=[^;]+;/);
    expect(sessions.rows.size).toBe(0);
    expect(st.exchanges).toBe(0);
  });

  it("user denied consent (?error=access_denied) → handled, not a 5xx", async () => {
    const res = await cb("?error=access_denied&state=STATE123", oauthCookie);
    expect(res.status).toBeLessThan(500);
    expect(sessions.rows.size).toBe(0);
  });

  it("Spotify rejects the code → 4xx/redirect, no session", async () => {
    st.exchange = async () => {
      throw new UnauthorizedError("Spotify rejected the sign-in");
    };
    const res = await cb("?code=CODE&state=STATE123", oauthCookie);
    expect(res.status).toBeLessThan(500);
    expect(sessions.rows.size).toBe(0);
  });

  it("an unexpected failure is a generic 500 whose body leaks no internals; the log is captured", async () => {
    st.exchange = async () => {
      throw new Error("internal detail: client_secret=qa-secret");
    };
    const res = await cb("?code=CODE&state=STATE123", oauthCookie);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("qa-secret");
    expect(logs.length).toBeGreaterThan(0); // proves our log capture works
  });

  it("admin only for ids in ADMIN_SPOTIFY_USER_IDS (env list is trimmed)", async () => {
    await signIn("bob");
    await signIn("alice");
    await signIn("mallory");
    await signIn("Alice");
    const roles = Object.fromEntries(
      [...users.rows.values()].map((u) => [u.spotifyUserId, u.role]),
    );
    expect(roles).toEqual({ bob: "admin", alice: "admin", mallory: "user", Alice: "user" });
  });
});

describe("QA guards (D-012)", () => {
  it("requireUser: valid session → user; no/unknown cookie → UnauthorizedError", async () => {
    const { sessionValue } = await signIn("mallory");
    const u = await requireUser(withSession(sessionValue));
    expect(u.spotifyUserId).toBe("mallory");
    expect(JSON.stringify(u)).not.toMatch(/SECRET/);
    await expect(requireUser(new Request("http://127.0.0.1:3000/x"))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    await expect(requireUser(withSession("forged"))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireUser: expired session → UnauthorizedError", async () => {
    const { sessionValue } = await signIn("mallory");
    clock.t = T0 + 31 * 24 * 3_600_000;
    await expect(requireUser(withSession(sessionValue))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireUser: malformed cookie encoding → UnauthorizedError, not a crash", async () => {
    await expect(requireUser(withSession("%E0%A4%A"))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      requireUser(new Request("http://x/", { headers: { cookie: "session" } })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireAdmin: user → ForbiddenError; admin → ok; anonymous → UnauthorizedError", async () => {
    const m = await signIn("mallory");
    await expect(requireAdmin(withSession(m.sessionValue))).rejects.toBeInstanceOf(ForbiddenError);
    const b = await signIn("bob");
    await expect(requireAdmin(withSession(b.sessionValue))).resolves.toMatchObject({
      role: "admin",
    });
    await expect(requireAdmin(new Request("http://x/"))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireAdmin: stored role 'admin' for an id NOT in ADMIN_SPOTIFY_USER_IDS is refused", async () => {
    // Ambiguity probe: a user removed from the env list keeps role=admin until next login.
    const eve = await users.upsertBySpotifyId({
      spotifyUserId: "eve",
      displayName: null,
      role: "admin",
    });
    await sessions.create("eve-session", asUserId(eve.id), new Date(T0 + 3_600_000));
    await expect(requireAdmin(withSession("eve-session"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("QA POST /api/auth/logout", () => {
  it("deletes the session and clears the cookie", async () => {
    const { sessionValue } = await signIn("mallory");
    const res = await logout(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${cookies.SESSION_COOKIE}=${sessionValue}` },
      }),
      ctx,
    );
    expect(res.status).toBeLessThan(400);
    expect(sessions.rows.size).toBe(0);
    const c = cookieFor(res, cookies.SESSION_COOKIE)!;
    expect(attrs(c)).toContain("max-age=0");
    await expect(requireUser(withSession(sessionValue))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("without a session cookie is harmless (not a 5xx)", async () => {
    const res = await logout(
      new Request("http://127.0.0.1:3000/api/auth/logout", { method: "POST" }),
      ctx,
    );
    expect(res.status).toBeLessThan(500);
  });
});

describe("QA cookie helpers (LLD §12, ENGINEERING §7)", () => {
  it.each([
    ["https://concerts.example.com", "production", true],
    ["https://concerts.example.com", "development", true],
    ["http://127.0.0.1:3000", "development", false],
    ["http://127.0.0.1.evil.com:3000", "development", true],
    ["http://evil.com/127.0.0.1", "development", true],
    ["http://10.0.0.5:3000", "development", true],
  ])("shouldUseSecureCookies(%s, %s) = %s", (url, envName, expected) => {
    expect(cookies.shouldUseSecureCookies(url, envName)).toBe(expected);
  });

  it("serializeCookie refuses or encodes attribute injection in the value", () => {
    let out: string | null = null;
    try {
      out = cookies.serializeCookie("session", "abc; Domain=evil.com; Secure=", {
        maxAgeSeconds: 60,
        path: "/",
        secure: false,
      });
    } catch {
      return;
    }
    expect(out!.toLowerCase()).not.toContain("domain=evil.com");
  });

  it("readCookie: picks the named cookie exactly, tolerates junk", () => {
    const req = (c: string) => new Request("http://x/", { headers: { cookie: c } });
    expect(cookies.readCookie(req("xsession=bad; session=good"), "session")).toBe("good");
    expect(cookies.readCookie(req("a=1;session=v=with=eq"), "session")).toBe("v=with=eq");
    expect(() => cookies.readCookie(req("session=%E0%A4%A"), "session")).not.toThrow();
    expect(cookies.readCookie(req(""), "session")).toBeNull();
  });

  it("sessionCookie: httpOnly, Lax, Path=/, Max-Age matches the expiry", () => {
    const c = cookies.sessionCookie("abc", new Date(T0 + 3_600_000), new Date(T0));
    const a = attrs(c);
    expect(a).toContain("httponly");
    expect(a).toContain("samesite=lax");
    expect(a).toContain("path=/");
    expect(a).toContain("max-age=3600");
  });

  it("clearSessionCookie expires it", () => {
    expect(attrs(cookies.clearSessionCookie())).toContain("max-age=0");
  });
});

describe("QA logger redaction (ENGINEERING §7: secrets never in logs)", () => {
  it.each([
    ["nested one level", { tokens: { accessToken: "LOG-SECRET-1" } }],
    ["top level", { accessToken: "LOG-SECRET-1" }],
    ["top level snake", { refresh_token: "LOG-SECRET-1" }],
    ["nested two levels", { res: { body: { access_token: "LOG-SECRET-1" } } }],
    ["authorization header", { req: { headers: { authorization: "Bearer LOG-SECRET-1" } } }],
  ])("%s is redacted", (_n, obj) => {
    // BUG: lib/logger.ts redact paths are "*.key" only, so top-level and ≥2-level-deep token keys (e.g. req.headers.authorization) are logged in clear.
    logger.warn(obj, "qa redaction probe");
    expect(logs).toContain("qa redaction probe");
    expect(logs).not.toContain("LOG-SECRET-1");
  });
});

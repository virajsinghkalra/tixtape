import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asUserId } from "@/domain/shared/ids";
import { resetEnvForTests } from "@/lib/env";
import { UnauthorizedError } from "@/lib/errors";
import { POST as logout } from "./logout/route";
import { GET as callback } from "./spotify/callback/route";
import { GET as login } from "./spotify/login/route";

const NOW = Date.UTC(2026, 10, 21);
const service = {
  startLogin: vi.fn(() => ({
    url: new URL("https://accounts.spotify.com/authorize?state=st"),
    state: "st",
    codeVerifier: "ver",
  })),
  completeLogin: vi.fn(),
  logout: vi.fn(async () => {}),
};
vi.mock("@/server/auth/spotify-auth", () => ({ authService: () => service }));
vi.mock("@/server/container", () => ({
  container: () => ({ clock: { now: () => new Date(NOW) } }),
}));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
  vi.stubEnv("NODE_ENV", "development");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => vi.clearAllMocks());

const ctx = {};
const callbackUrl = (query: string) => `http://127.0.0.1:3000/api/auth/spotify/callback?${query}`;

describe("auth routes", () => {
  it("login redirects to Spotify and sets the state and verifier cookies", async () => {
    const res = await login(new Request("http://127.0.0.1:3000/api/auth/spotify/login"), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://accounts.spotify.com/authorize?state=st");
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.includes("HttpOnly") && c.includes("SameSite=Lax"))).toBe(true);
  });

  it("callback passes cookie values to the service and sets the session cookie", async () => {
    service.completeLogin.mockResolvedValueOnce({
      sessionId: "sid",
      expiresAt: new Date(NOW + 1000_000),
      user: { id: asUserId("u1") },
    });
    const req = new Request(callbackUrl("code=c&state=st"), {
      headers: { cookie: "spotify_oauth_state=st; spotify_oauth_verifier=ver" },
    });
    const res = await callback(req, ctx);
    expect(service.completeLogin).toHaveBeenCalledWith({
      code: "c",
      state: "st",
      expectedState: "st",
      codeVerifier: "ver",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/");
    const cookies = res.headers.getSetCookie();
    expect(cookies[0]).toBe("session=sid; Path=/; Max-Age=1000; HttpOnly; SameSite=Lax");
    expect(cookies.slice(1).every((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  it("callback redirects home with a fixed error code when the user declines", async () => {
    const res = await callback(new Request(callbackUrl("error=<script>&state=st")), ctx);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:3000/?auth_error=spotify_denied");
    expect(service.completeLogin).not.toHaveBeenCalled();
  });

  it("callback answers 400 without a code and 401 on a state mismatch", async () => {
    expect((await callback(new Request(callbackUrl("state=st")), ctx)).status).toBe(400);
    service.completeLogin.mockRejectedValueOnce(new UnauthorizedError("mismatch"));
    expect((await callback(new Request(callbackUrl("code=c&state=x")), ctx)).status).toBe(401);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const res = await logout(
      new Request("http://127.0.0.1:3000/api/auth/logout", {
        method: "POST",
        headers: { cookie: "session=sid" },
      }),
      ctx,
    );
    expect(service.logout).toHaveBeenCalledWith("sid");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session=; Path=/; Max-Age=0");
  });
});

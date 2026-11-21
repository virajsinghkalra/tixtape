import { createHash } from "node:crypto";
import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { UnauthorizedError, UpstreamError } from "@/lib/errors";
import { ArcticSpotifyOAuth } from "./oauth";
import { FakeClock, T0 } from "./test-support";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:3000/api/auth/spotify/callback",
};
const basic = `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`;
const oauth = () => new ArcticSpotifyOAuth(config, new FakeClock(), (i, init) => fetch(i, init));

/** Captures the token request body and answers with `response`. */
function tokenEndpoint(response: () => Response) {
  const seen: { body?: URLSearchParams; auth?: string | null } = {};
  server.use(
    mock.post(TOKEN_URL, async ({ request }) => {
      seen.body = new URLSearchParams(await request.text());
      seen.auth = request.headers.get("authorization");
      return response();
    }),
  );
  return seen;
}

const tokens =
  (extra: object = {}) =>
  () =>
    HttpResponse.json({
      access_token: "at",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "a b",
      ...extra,
    });

describe("ArcticSpotifyOAuth", () => {
  it("builds an authorization URL with PKCE S256, state and the playlist scopes", () => {
    const { url, state, codeVerifier } = oauth().beginAuthorization();
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("client-id");
    expect(p.get("redirect_uri")).toBe(config.redirectUri);
    expect(p.get("state")).toBe(state);
    expect(p.get("scope")).toBe("playlist-modify-private playlist-modify-public");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(
      createHash("sha256").update(codeVerifier).digest("base64url"),
    );
  });

  it("creates fresh state and verifier on every call", () => {
    const a = oauth().beginAuthorization();
    const b = oauth().beginAuthorization();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("exchanges a code with the verifier", async () => {
    const seen = tokenEndpoint(tokens({ refresh_token: "rt" }));
    await expect(oauth().exchangeCode("the-code", "the-verifier")).resolves.toEqual({
      accessToken: "at",
      refreshToken: "rt",
      scope: "a b",
      expiresAt: new Date(T0 + 3_600_000),
    });
    expect(seen.body?.get("grant_type")).toBe("authorization_code");
    expect(seen.body?.get("code")).toBe("the-code");
    expect(seen.body?.get("code_verifier")).toBe("the-verifier");
    expect(seen.auth).toBe(basic);
  });

  it("maps a rejected code to UnauthorizedError", async () => {
    tokenEndpoint(() => HttpResponse.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(oauth().exchangeCode("bad", "v")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requires a refresh token from the code exchange", async () => {
    tokenEndpoint(tokens());
    await expect(oauth().exchangeCode("c", "v")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("refreshes, returning a rotated refresh token or null", async () => {
    const seen = tokenEndpoint(tokens({ refresh_token: "rotated" }));
    const result = await oauth().refresh("old-rt");
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ refreshToken: "rotated" }),
    });
    expect(seen.body?.get("grant_type")).toBe("refresh_token");
    expect(seen.body?.get("refresh_token")).toBe("old-rt");

    tokenEndpoint(tokens());
    const again = await oauth().refresh("old-rt");
    expect(again.ok && again.value.refreshToken).toBeNull();
  });

  it("returns invalid_grant as a value", async () => {
    tokenEndpoint(() => HttpResponse.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(oauth().refresh("revoked")).resolves.toEqual({
      ok: false,
      error: "invalid_grant",
    });
  });

  it("throws UpstreamError on other refresh failures, without leaking the token", async () => {
    tokenEndpoint(() => new HttpResponse("nope", { status: 503 }));
    const error = await oauth()
      .refresh("secret-refresh-token")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).not.toContain("secret-refresh-token");
  });

  it("gets an app token with client credentials", async () => {
    const seen = tokenEndpoint(tokens());
    await expect(oauth().clientCredentials()).resolves.toEqual({
      accessToken: "at",
      expiresAt: new Date(T0 + 3_600_000),
    });
    expect(seen.body?.get("grant_type")).toBe("client_credentials");
    expect(seen.auth).toBe(basic);
  });

  it("rejects a malformed token response", async () => {
    tokenEndpoint(() => HttpResponse.json({ access_token: "" }));
    await expect(oauth().clientCredentials()).rejects.toBeInstanceOf(UpstreamError);
  });
});

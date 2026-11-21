import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ArcticSpotifyOAuth, SPOTIFY_SCOPES } from "@/infrastructure/spotify/oauth";
import { UnauthorizedError } from "@/lib/errors";
import { FakeClock, T0, dump } from "./fakes";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const cfg = {
  clientId: "qa-client-id",
  clientSecret: "qa-client-secret-XYZ",
  redirectUri: "http://127.0.0.1:3000/api/auth/spotify/callback",
};
const oauth = () =>
  new ArcticSpotifyOAuth(cfg, new FakeClock(), (i, init) => globalThis.fetch(i, init));

type Seen = { form: URLSearchParams; auth: string | null };
function tokenEndpoint(status: number, body: unknown, seen: Seen[] = []) {
  server.use(
    mock.post(TOKEN_URL, async ({ request }) => {
      seen.push({
        form: new URLSearchParams(await request.text()),
        auth: request.headers.get("authorization"),
      });
      return HttpResponse.json(body as never, { status });
    }),
  );
  return seen;
}

describe("QA beginAuthorization (LLD §3 OAuth: code + PKCE S256 + state)", () => {
  it("builds a Spotify authorize URL with PKCE S256, state and app scopes", () => {
    const a = oauth().beginAuthorization();
    expect(a.url.origin + a.url.pathname).toBe("https://accounts.spotify.com/authorize");
    const q = a.url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(cfg.clientId);
    expect(q.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBeTruthy();
    expect(q.get("state")).toBe(a.state);
    const scopes = (q.get("scope") ?? "").split(" ");
    expect(scopes).toEqual(
      expect.arrayContaining(["playlist-modify-private", "playlist-modify-public"]),
    );
    expect(scopes).not.toContain("ugc-image-upload");
    expect([...SPOTIFY_SCOPES].sort()).toEqual([
      "playlist-modify-private",
      "playlist-modify-public",
    ]);
  });

  it("never puts the verifier or client secret in the URL", () => {
    const a = oauth().beginAuthorization();
    expect(a.url.toString()).not.toContain(a.codeVerifier);
    expect(a.url.toString()).not.toContain(cfg.clientSecret);
    expect(a.url.searchParams.get("code_challenge")).not.toBe(a.codeVerifier);
  });

  it("state and verifier are unpredictable (unique, high entropy)", () => {
    const o = oauth();
    const all = Array.from({ length: 50 }, () => o.beginAuthorization());
    expect(new Set(all.map((a) => a.state)).size).toBe(50);
    expect(new Set(all.map((a) => a.codeVerifier)).size).toBe(50);
    for (const a of all) {
      expect(a.state.length).toBeGreaterThanOrEqual(16);
      expect(a.codeVerifier.length).toBeGreaterThanOrEqual(43);
    }
  });
});

describe("QA exchangeCode", () => {
  it("returns a token set with expiresAt from the clock", async () => {
    const seen = tokenEndpoint(200, {
      access_token: "AT",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "RT",
      scope: "playlist-modify-private playlist-modify-public",
    });
    const t = await oauth().exchangeCode("the-code", "the-verifier");
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT" });
    expect(t.expiresAt.getTime()).toBeGreaterThanOrEqual(T0 + 3_500_000);
    expect(t.expiresAt.getTime()).toBeLessThanOrEqual(T0 + 3_600_000);
    expect(seen[0]!.form.get("code_verifier")).toBe("the-verifier");
    expect(seen[0]!.form.get("grant_type")).toBe("authorization_code");
  });

  it("rejected code → UnauthorizedError that leaks neither code nor secret", async () => {
    tokenEndpoint(400, { error: "invalid_grant", error_description: "Invalid authorization code" });
    const e = await oauth()
      .exchangeCode("secret-code-123", "v")
      .then(
        () => null,
        (x: unknown) => x,
      );
    expect(e).toBeInstanceOf(UnauthorizedError);
    const s = dump(e) + (e as Error).message;
    expect(s).not.toContain("secret-code-123");
    expect(s).not.toContain(cfg.clientSecret);
  });

  it("a token response without refresh_token is rejected (we cannot store a session without it)", async () => {
    tokenEndpoint(200, { access_token: "AT", token_type: "Bearer", expires_in: 3600, scope: "" });
    await expect(oauth().exchangeCode("c", "v")).rejects.toBeTruthy();
  });

  it("malformed token JSON → error, not a token set with undefined fields", async () => {
    tokenEndpoint(200, { access_token: 5 });
    await expect(oauth().exchangeCode("c", "v")).rejects.toBeTruthy();
  });
});

describe("QA refresh (LLD §8.1)", () => {
  it("uses client auth and returns rotated refresh token", async () => {
    const seen = tokenEndpoint(200, {
      access_token: "AT2",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "RT2",
      scope: "playlist-modify-private",
    });
    const r = await oauth().refresh("RT1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ accessToken: "AT2", refreshToken: "RT2" });
    expect(seen[0]!.form.get("grant_type")).toBe("refresh_token");
    expect(seen[0]!.form.get("refresh_token")).toBe("RT1");
    const basic = seen[0]!.auth;
    const viaBasic =
      basic === `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
    const viaBody = seen[0]!.form.get("client_id") === cfg.clientId;
    expect(viaBasic || viaBody).toBe(true);
  });

  it("omitted refresh_token → refreshToken null (keep the old one)", async () => {
    tokenEndpoint(200, { access_token: "AT2", token_type: "Bearer", expires_in: 3600, scope: "s" });
    const r = await oauth().refresh("RT1");
    expect(r.ok && r.value.refreshToken).toBe(null);
  });

  it("invalid_grant → Result error 'invalid_grant'", async () => {
    tokenEndpoint(400, { error: "invalid_grant", error_description: "Refresh token revoked" });
    const r = await oauth().refresh("RT1");
    expect(r).toEqual({ ok: false, error: "invalid_grant" });
  });

  it.each([
    [500, { error: "server_error" }],
    [503, {}],
  ])(
    "transient %i is NOT reported as invalid_grant (must not force re-login)",
    async (status, body) => {
      tokenEndpoint(status, body);
      const r = await oauth()
        .refresh("RT1")
        .then(
          (x) => x,
          () => "threw" as const,
        );
      if (r !== "threw") expect(r.ok === false && r.error === "invalid_grant").toBe(false);
    },
  );

  it("refresh error does not leak the refresh token", async () => {
    tokenEndpoint(500, { error: "server_error" });
    const e = await oauth()
      .refresh("RT-SECRET-1")
      .then(
        (x) => x,
        (x: unknown) => x,
      );
    expect(dump(e) + String((e as Error)?.message)).not.toContain("RT-SECRET-1");
  });
});

describe("QA clientCredentials", () => {
  it("returns an app token", async () => {
    const seen = tokenEndpoint(200, {
      access_token: "APP",
      token_type: "Bearer",
      expires_in: 3600,
    });
    const t = await oauth().clientCredentials();
    expect(t.accessToken).toBe("APP");
    expect(t.expiresAt.getTime()).toBeGreaterThan(T0);
    expect(seen[0]!.form.get("grant_type")).toBe("client_credentials");
  });
});

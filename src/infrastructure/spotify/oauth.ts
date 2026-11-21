/**
 * Spotify Accounts service: Authorization Code + PKCE + state via arctic (LLD §3, §8.1), and the
 * client-credentials app token (D-009). Token responses are Zod-validated; tokens never reach
 * logs or error messages.
 */
import {
  ArcticFetchError,
  OAuth2RequestError,
  Spotify,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { z } from "zod";
import type {
  AuthorizationRequest,
  RefreshedTokens,
  SpotifyOAuth,
  SpotifyTokenSet,
} from "@/application/auth/ports";
import type { Clock } from "@/application/ports/clock";
import { UnauthorizedError, UpstreamError } from "@/lib/errors";
import { err, ok, type Result } from "@/lib/result";
import type { AppToken, AppTokenClient } from "./access-tokens";

/** LLD §8.1. Add `ugc-image-upload` only when playlist covers ship. */
export const SPOTIFY_SCOPES = ["playlist-modify-private", "playlist-modify-public"] as const;

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const UPSTREAM = "spotify-accounts";

const TOKEN_RESPONSE = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export type SpotifyOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class ArcticSpotifyOAuth implements SpotifyOAuth, AppTokenClient {
  private readonly spotify: Spotify;

  constructor(
    private readonly config: SpotifyOAuthConfig,
    private readonly clock: Clock,
    private readonly fetchFn: typeof fetch,
  ) {
    this.spotify = new Spotify(config.clientId, config.clientSecret, config.redirectUri);
  }

  beginAuthorization(): AuthorizationRequest {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = this.spotify.createAuthorizationURL(state, codeVerifier, [...SPOTIFY_SCOPES]);
    // Always show Spotify's consent screen (with "Not you?") so people can switch accounts,
    // e.g. connecting the publisher account from a browser already logged in as someone else.
    url.searchParams.set("show_dialog", "true");
    return { url, state, codeVerifier };
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<SpotifyTokenSet> {
    let data: object;
    try {
      data = (await this.spotify.validateAuthorizationCode(code, codeVerifier)).data;
    } catch (e) {
      if (e instanceof OAuth2RequestError) {
        throw new UnauthorizedError("Spotify sign-in failed. Please try again.");
      }
      throw upstream(e);
    }
    const tokens = this.toTokens(data);
    if (!tokens.refreshToken) throw new UpstreamError(UPSTREAM, "Spotify sent no refresh token.");
    return { ...tokens, refreshToken: tokens.refreshToken };
  }

  async refresh(refreshToken: string): Promise<Result<RefreshedTokens, "invalid_grant">> {
    try {
      const tokens = await this.spotify.refreshAccessToken(refreshToken);
      return ok(this.toTokens(tokens.data));
    } catch (e) {
      if (e instanceof OAuth2RequestError && e.code === "invalid_grant")
        return err("invalid_grant");
      throw upstream(e);
    }
  }

  async clientCredentials(): Promise<AppToken> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64",
    );
    let res: Response;
    try {
      res = await this.fetchFn(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
      });
    } catch (e) {
      throw upstream(e);
    }
    if (!res.ok)
      throw new UpstreamError(UPSTREAM, `App token request failed (HTTP ${res.status}).`);
    const { accessToken, expiresAt } = this.toTokens(await res.json().catch(() => null));
    return { accessToken, expiresAt };
  }

  private toTokens(data: unknown): RefreshedTokens {
    const parsed = TOKEN_RESPONSE.safeParse(data);
    if (!parsed.success) {
      throw new UpstreamError(UPSTREAM, "Spotify sent a token response we didn't understand.");
    }
    const t = parsed.data;
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      scope: t.scope ?? "",
      expiresAt: new Date(this.clock.now().getTime() + t.expires_in * 1000),
    };
  }
}

function upstream(e: unknown): UpstreamError {
  const message =
    e instanceof ArcticFetchError
      ? "Couldn't reach Spotify. Try again in a moment."
      : "Spotify sign-in service failed. Try again in a moment.";
  // `cause` keeps the error class for logs; arctic errors carry no token values.
  return new UpstreamError(UPSTREAM, message, { cause: e });
}

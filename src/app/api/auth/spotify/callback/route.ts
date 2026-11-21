import { z } from "zod";
import { env } from "@/lib/env";
import {
  clearOauthCookies,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  readCookie,
  redirectWithCookies,
  sessionCookie,
} from "@/server/auth/cookies";
import { authService } from "@/server/auth/spotify-auth";
import { container } from "@/server/container";
import { parseWith, route } from "@/server/http";

const callbackQuery = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
});

/** Spotify redirects here after consent. Sets the session cookie and returns to the app. */
export const GET = route(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const home = new URL("/", env().APP_URL);
  if (params.has("error")) {
    // The user declined (or Spotify failed); don't reflect Spotify's text back.
    home.searchParams.set("auth_error", "spotify_denied");
    return redirectWithCookies(home.toString(), clearOauthCookies());
  }
  const { code, state } = parseWith(callbackQuery, Object.fromEntries(params));
  const session = await authService().completeLogin({
    code,
    state,
    expectedState: readCookie(req, OAUTH_STATE_COOKIE),
    codeVerifier: readCookie(req, OAUTH_VERIFIER_COOKIE),
  });
  return redirectWithCookies(home.toString(), [
    sessionCookie(session.sessionId, session.expiresAt, container().clock.now()),
    ...clearOauthCookies(),
  ]);
});

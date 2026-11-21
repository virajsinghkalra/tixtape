import { oauthCookies, redirectWithCookies } from "@/server/auth/cookies";
import { authService } from "@/server/auth/spotify-auth";
import { route } from "@/server/http";

/** Starts Spotify sign-in: Authorization Code + PKCE + state (LLD §8.1). */
export const GET = route(async () => {
  const { url, state, codeVerifier } = authService().startLogin();
  return redirectWithCookies(url.toString(), oauthCookies(state, codeVerifier));
});

import { clearSessionCookie, readCookie, SESSION_COOKIE } from "@/server/auth/cookies";
import { authService } from "@/server/auth/spotify-auth";
import { json, route } from "@/server/http";

/** Ends the session. Spotify tokens are kept; `DELETE /api/me` disconnects fully. */
export const POST = route(async (req: Request) => {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (sessionId) await authService().logout(sessionId);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
});

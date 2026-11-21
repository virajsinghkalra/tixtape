import { clearSessionCookie } from "@/server/auth/cookies";
import { requireUser } from "@/server/auth/guards";
import { authService } from "@/server/auth/spotify-auth";
import { route } from "@/server/http";

/**
 * Disconnect: deletes the user and, by cascade, their Spotify tokens, sessions, playlists and
 * jobs (LLD §4, Spotify Terms Appendix A §5(c), D-070).
 */
export const DELETE = route(async (req: Request) => {
  const user = await requireUser(req);
  await authService().deleteAccount(user.id);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
});

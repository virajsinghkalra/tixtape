/**
 * Request guards (D-012). Owned by the Spotify Integration team (P1.2). Signatures are a
 * contract: don't change them without a DECISIONS.md entry.
 */
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import type { UserId } from "@/domain/shared/ids";
import { readCookie, SESSION_COOKIE } from "./cookies";
import { authService } from "./spotify-auth";

export type SessionUser = {
  id: UserId;
  spotifyUserId: string;
  displayName: string | null;
  market: string;
  role: "user" | "admin";
};

/** Returns the signed-in user, or throws UnauthorizedError (401). */
export async function requireUser(req: Request): Promise<SessionUser> {
  const sessionId = readCookie(req, SESSION_COOKIE);
  const user = sessionId ? await authService().getSessionUser(sessionId) : null;
  if (!user) throw new UnauthorizedError("Sign in with Spotify to continue.");
  return user;
}

/** Returns the signed-in admin, or throws UnauthorizedError (401) / ForbiddenError (403). */
export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw new ForbiddenError("This page is for admins only.");
  return user;
}

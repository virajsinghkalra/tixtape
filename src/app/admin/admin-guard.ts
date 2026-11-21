import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireAdmin, type SessionUser } from "@/server/auth/guards";

/**
 * Admin pages are invisible to everyone else: signed out or not an admin is the same 404 as a
 * page that doesn't exist, so the console can't be discovered. Called by every admin page (not
 * only the layout, which renders in parallel with the page). Other failures reach error.tsx.
 */
export const requireAdminPage = cache(async (): Promise<SessionUser> => {
  const cookie = (await headers()).get("cookie");
  const req = new Request("http://admin.local/admin", cookie ? { headers: { cookie } } : {});
  try {
    return await requireAdmin(req);
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) notFound();
    throw err;
  }
});

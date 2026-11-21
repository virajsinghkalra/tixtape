import { requireAdmin } from "@/server/auth/guards";
import { json, route } from "@/server/http";
import { playlists, requireEmptyBody } from "@/server/playlists";

/** GET /api/admin/publisher: `{connected, displayName, needsReauth}` (D-036). Admin only. */
export const GET = route(async (req: Request) => {
  await requireAdmin(req);
  return json(await playlists().getPublisherStatus());
});

/**
 * POST /api/admin/publisher: makes the signed-in admin the publisher of shared playlists.
 * Body: none or `{}`. 409 when the admin's Spotify sign-in needs renewing.
 */
export const POST = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  await requireEmptyBody(req);
  return json(await playlists().setPublisher(admin.id));
});

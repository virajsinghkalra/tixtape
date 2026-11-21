import { requireAdmin } from "@/server/auth/guards";
import { events } from "@/server/events";
import { json, route } from "@/server/http";

/**
 * GET /api/admin/events/needs-image (D-091): upcoming published events with no poster and no
 * headliner photo. They stay published; this is the admin's "needs image" list.
 * 200 `{ events: [{ id, title, startsAt }] }`; 401/403 from the guard.
 */
export const GET = route(async (req: Request) => {
  await requireAdmin(req);
  const rows = await events().listEventsNeedingImage();
  return json({ events: rows.map(({ id, title, startsAt }) => ({ id, title, startsAt })) });
});

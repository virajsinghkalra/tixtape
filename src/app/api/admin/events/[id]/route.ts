import { AdminEventPatchSchema, parseEventId } from "@/application/events";
import { requireAdmin } from "@/server/auth/guards";
import { events } from "@/server/events";
import { invalidateFeed } from "@/server/front-page";
import { json, parseBody, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/events/:id: any visibility, with lineup, sources and verification state. */
export const GET = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  return json({ event: await events().getAdminEvent(parseEventId(id)) });
});

/**
 * PATCH /api/admin/events/:id: partial update; a given `lineup` replaces the whole lineup.
 * `{ visibility: "published" | "held" | "archived" }` alone publishes, holds or archives (D-056).
 */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  const eventId = parseEventId(id);
  const patch = await parseBody(req, AdminEventPatchSchema);
  const updated = await events().updateAdminEvent(eventId, patch);
  invalidateFeed(); // QA-F-15: visibility or facts changed; the home feed re-reads now.
  return json(updated);
});

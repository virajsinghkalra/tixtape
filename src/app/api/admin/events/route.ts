import { AdminEventInputSchema, AdminListEventsQuerySchema } from "@/application/events";
import { requireAdmin } from "@/server/auth/guards";
import { events } from "@/server/events";
import { json, parseBody, parseWith, route } from "@/server/http";

/**
 * GET /api/admin/events: the public filters plus `visibility`; every visibility by default,
 * each item with `visibility`, `confidence`, `lastVerifiedAt` (D-056).
 */
export const GET = route(async (req: Request) => {
  await requireAdmin(req);
  const query = parseWith(
    AdminListEventsQuerySchema,
    Object.fromEntries(new URL(req.url).searchParams),
  );
  const page = await events().listAdminEvents(query);
  return json({ events: page.items, page: page.page, pageSize: page.pageSize, total: page.total });
});

/**
 * POST /api/admin/events: create an event with venue and ordered lineup (P1.7).
 * New events are `held` unless the body says `visibility: "published"` (D-056).
 * 201 when created; 200 when it matched an existing event, which now carries the admin data.
 */
export const POST = route(async (req: Request) => {
  await requireAdmin(req);
  const input = await parseBody(req, AdminEventInputSchema);
  const result = await events().createAdminEvent(input);
  return json(result, result.outcome === "created" ? 201 : 200);
});

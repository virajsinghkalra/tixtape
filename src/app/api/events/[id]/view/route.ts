import { parseEventId } from "@/application/events";
import { clientKey, events } from "@/server/events";
import { route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/events/:id/view (D-047): bumps the event's trend score. 204; 404 unknown event;
 * 429 over the per-client limit. Repeat views of the same event are accepted, not counted.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await events().recordEventView(parseEventId(id), clientKey(req));
  return new Response(null, { status: 204 });
});

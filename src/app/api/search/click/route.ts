import { SearchClickSchema } from "@/application/events";
import { clientKey, events } from "@/server/events";
import { parseBody, route } from "@/server/http";

/**
 * POST /api/search/click `{ q, eventId }` (D-047, D-048): a search result was opened.
 * 204; 404 unknown event; 429 over the per-client limit. Anonymous: nothing about the
 * caller is stored.
 */
export const POST = route(async (req: Request) => {
  const click = await parseBody(req, SearchClickSchema);
  await events().recordSearchClick(click, clientKey(req));
  return new Response(null, { status: 204 });
});

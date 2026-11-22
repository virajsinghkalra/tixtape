import { parseEventId } from "@/application/events";
import { NotFoundError } from "@/lib/errors";
import { EDGE_CACHE_SHORT, json, route } from "@/server/http";
import { listenNow } from "@/server/listen-now";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id/listen-now: the interim fallback while an event has no shared playlist.
 * `{ sibling?: {url, title}, artists: [{name, spotifyId}] }`. Database only, no Spotify calls.
 * Cached 60 s at the edge. 404 for events that are not published.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const eventId = parseEventId((await ctx.params).id);
  const result = await listenNow(eventId);
  if (!result) throw new NotFoundError("Event not found");
  return json(result, 200, EDGE_CACHE_SHORT);
});

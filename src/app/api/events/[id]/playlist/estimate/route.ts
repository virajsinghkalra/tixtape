import { parseEventId } from "@/application/events";
import { json, route } from "@/server/http";
import { playlists } from "@/server/playlists";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id/playlist/estimate: the "Make playlist" preview, from the same plan the
 * build fills (D-065). Public. 200 `{songs, minutes, perTier: [{tier, artists, songs, minutes}],
 * showMinutes, days, unmatched}` · 404.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const estimate = await playlists().estimatePlaylist(parseEventId((await ctx.params).id));
  return json(estimate, 200, { "Cache-Control": "no-store" });
});

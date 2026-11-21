import { parseJobId } from "@/application/playlists";
import { json, route } from "@/server/http";
import { playlists, requireEmptyBody } from "@/server/playlists";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/playlist-jobs/:id/step: up to ~8 s of work, then progress (D-005). Public; the
 * browser calls it about every 1.5 s, or after `resumeAfter` when Spotify asked us to wait.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const jobId = parseJobId((await ctx.params).id);
  await requireEmptyBody(req);
  return json(await playlists().step(jobId), 200, { "Cache-Control": "no-store" });
});

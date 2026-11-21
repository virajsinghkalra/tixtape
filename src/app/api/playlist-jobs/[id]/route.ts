import { parseJobId } from "@/application/playlists";
import { json, route } from "@/server/http";
import { playlists } from "@/server/playlists";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/playlist-jobs/:id: progress without doing any work. Public. */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const progress = await playlists().getProgress(parseJobId((await ctx.params).id));
  return json(progress, 200, { "Cache-Control": "no-store" });
});

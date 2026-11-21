import { z } from "zod";
import { CancelJobInputSchema } from "@/application/admin";
import { asPlaylistJobId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import { adminConsole } from "@/server/admin-console";
import { requireAdmin } from "@/server/auth/guards";
import { json, parseBody, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/playlist-jobs/:id/cancel: stops a queued, running or paused job by marking
 * it `failed` with a user-readable reason. Body: `{}` or `{reason}` (≤ 200 chars, shown to
 * people watching the build). 200 `{jobId, status:"failed", error}`; 404 unknown job;
 * 409 already finished.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  // A malformed ID can't name a job: same 404 as a missing one.
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("That playlist job doesn't exist.");
  const input = await parseBody(req, CancelJobInputSchema);
  return json(await adminConsole().cancelJob(asPlaylistJobId(id), input));
});

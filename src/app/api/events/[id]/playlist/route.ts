import { parseEventId } from "@/application/events";
import { PlaylistUnavailableError } from "@/application/playlists";
import { RateLimitedError } from "@/lib/errors";
import { json, route, type ErrorBody } from "@/server/http";
import { sharedOrTourStatus } from "@/server/listen-now";
import { clientKey, playlists, requireEmptyBody } from "@/server/playlists";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/events/:id/playlist: "Make playlist" (D-036). No login needed. Body: none or `{}`.
 * 200 `{status:"ready", url}` · 202 `{status:"building", jobId}` · 404 · 422 no_matched_artists ·
 * 429 rate_limited (with Retry-After) · 503 playlist_unavailable.
 */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const eventId = parseEventId((await ctx.params).id);
  await requireEmptyBody(req);
  try {
    const result = await playlists().startSharedBuild(eventId, clientKey(req));
    return json(result, result.status === "ready" ? 200 : 202);
  } catch (e) {
    // Already logged once a minute at `warn` by the use case (D-045): no error stack per request.
    if (e instanceof PlaylistUnavailableError) {
      return json<ErrorBody>({ error: { code: e.code, message: e.message } }, 503);
    }
    if (!(e instanceof RateLimitedError)) throw e;
    const headers = e.retryAfterSeconds
      ? { "Retry-After": String(e.retryAfterSeconds) }
      : undefined;
    return json<ErrorBody>({ error: { code: e.code, message: e.message } }, 429, headers);
  }
});

/** GET /api/events/:id/playlist: `{status:"none"|"building"|"ready", url?, builtAt?, stale?, jobId?}`. */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const status = await sharedOrTourStatus(parseEventId((await ctx.params).id));
  return json(status, 200, { "Cache-Control": "no-store" });
});

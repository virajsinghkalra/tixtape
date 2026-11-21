import { LookupRequestSchema } from "@/application/ingestion/live-lookup";
import { clientKey } from "@/server/events";
import { json, parseBody, route } from "@/server/http";
import { lookup } from "@/server/lookup";

/**
 * POST /api/lookup `{ q }` (D-050, D-070). Public. Called when a typed search found nothing.
 * Answers within about 6 seconds with the final result and its `lookupId`:
 * `{status:"found", results} | {status:"not_found", artist?, artists?, ambiguous?}`, or
 * `{status:"searching"}` only when the global cap is reached. Repeats come from the cache.
 * 400 invalid body; 429 over the per-client limit.
 */
export const POST = route(async (req: Request) => {
  const { q } = await parseBody(req, LookupRequestSchema);
  return json(await lookup().lookup(q, clientKey(req)));
});

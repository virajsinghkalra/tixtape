import { parseEventId } from "@/application/events";
import { events } from "@/server/events";
import { json, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/events/:id: event + lineup with tier and match status (LLD §9). Public.
 * Published events only: held or archived is 404 (D-056). Includes
 * `verification: { sourcesCount, lastVerifiedAt, sources: [{ source, url }] }`.
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { sources: _sources, ...event } = await events().getEvent(parseEventId(id));
  return json({ event });
});

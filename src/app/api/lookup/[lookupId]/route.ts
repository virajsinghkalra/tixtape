import { z } from "zod";
import { NotFoundError } from "@/lib/errors";
import { json, parseWith, route } from "@/server/http";
import { lookup } from "@/server/lookup";

const ParamsSchema = z.strictObject({ lookupId: z.string().regex(/^[0-9a-f]{32}$/u) });

/**
 * GET /api/lookup/:lookupId (D-070). Public. The cached answer for a lookup, in the same shapes
 * as POST /api/lookup. 404 for an unknown or expired lookup.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ lookupId: string }> }) => {
  const { lookupId } = parseWith(ParamsSchema, await ctx.params);
  const state = lookup().poll(lookupId);
  if (!state) throw new NotFoundError("That lookup has finished or expired.");
  return json(state);
});

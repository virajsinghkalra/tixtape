import { z } from "zod";
import { asArtistId, asSpotifyArtistId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import { requireAdmin } from "@/server/auth/guards";
import { json, parseBody, parseWith, route } from "@/server/http";
import { matching } from "@/server/matching";

const params = z.strictObject({ id: z.uuid() });

// D-018: unknown fields are rejected, not dropped.
const body = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("approve"),
    // Spotify IDs are 22 base-62 characters.
    spotifyArtistId: z.string().regex(/^[0-9A-Za-z]{22}$/u),
  }),
  z.strictObject({ action: z.literal("not_found") }),
]);

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/artists/:id
 * `{action:"approve", spotifyArtistId}` → 200 `{artistId, matchStatus:"manual", spotifyId}`
 * `{action:"not_found"}` → 200 `{artistId, matchStatus:"not_found", spotifyId:null}`
 */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const artistId = asArtistId(parseWith(params, await ctx.params).id);
  const input = await parseBody(req, body);
  const result =
    input.action === "approve"
      ? await matching().approveMatch(artistId, asSpotifyArtistId(input.spotifyArtistId))
      : await matching().markNotFound(artistId);
  if (!result.ok) throw new NotFoundError("That artist doesn't exist. Refresh the review queue.");
  return json({
    artistId,
    matchStatus: input.action === "approve" ? "manual" : "not_found",
    spotifyId: input.action === "approve" ? input.spotifyArtistId : null,
  });
});

import { z } from "zod";
import type { ReviewItem } from "@/application/matching";
import { requireAdmin } from "@/server/auth/guards";
import { json, parseWith, route } from "@/server/http";
import { matching } from "@/server/matching";

// D-018: unknown parameters are rejected, not dropped.
const query = z.strictObject({
  status: z.literal("needs_review"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function toDto({ artist, candidates, candidatesSource }: ReviewItem) {
  return {
    id: artist.id,
    name: artist.name,
    normalizedName: artist.normalizedName,
    matchStatus: artist.matchStatus,
    matchScore: artist.matchScore,
    spotifyResolvedAt: artist.spotifyResolvedAt,
    candidatesSource,
    candidates: candidates.map(({ candidate, score, breakdown }) => ({
      spotifyArtistId: candidate.id,
      name: candidate.name,
      rank: candidate.rank,
      imageUrl: candidate.imageUrl,
      genres: candidate.genres,
      score,
      breakdown,
    })),
  };
}

/** GET /api/admin/artists?status=needs_review&limit=50: the review queue (LLD §9). */
export const GET = route(async (req: Request) => {
  await requireAdmin(req);
  const params = parseWith(query, Object.fromEntries(new URL(req.url).searchParams));
  const items = await matching().listReviewQueue(params.limit);
  return json({ artists: items.map(toDto) });
});

import { z } from "zod";
import { clientKey } from "@/server/client-key";
import { similarShowsFor } from "@/server/discovery";
import { json, parseWith, route } from "@/server/http";

const ParamsSchema = z.strictObject({ artist: z.string().trim().min(2).max(100) });

/**
 * GET /api/search/similar?artist= (UX #7, OD-8, D-088). Public. Upcoming shows by artists that
 * sound like `artist` (Last.fm `artist.getSimilar`, cached), for a zero-result search.
 * `{ artists: string[], shows: EventResult & { artist } [] }`; 429 when a client asks too often.
 */
export const GET = route(async (req: Request) => {
  const { artist } = parseWith(ParamsSchema, Object.fromEntries(new URL(req.url).searchParams));
  const answer = await similarShowsFor(artist, clientKey(req));
  return json(answer, 200, { "Cache-Control": "public, max-age=600, s-maxage=600" });
});

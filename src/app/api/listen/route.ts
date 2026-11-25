import { z } from "zod";
import { json, parseWith, route } from "@/server/http";
import { listenData } from "@/server/song-preview";

const QuerySchema = z.strictObject({
  url: z
    .string()
    .max(200)
    .regex(/^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]+$/u),
});

/**
 * GET /api/listen?url=<playlist URL>: the first song with a 30-second preview, for "Listen
 * here" to start playing on the tap, and the playlist's top songs:
 * `{ song: { name, artist, audio } | null, tracks: [{ name, artist }] }`. Public.
 */
export const GET = route(async (req: Request) => {
  const { url } = parseWith(QuerySchema, Object.fromEntries(new URL(req.url).searchParams));
  return json(await listenData(url), 200, {
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  });
});

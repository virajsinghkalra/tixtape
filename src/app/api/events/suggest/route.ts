import { SuggestParamsSchema } from "@/application/events";
import { events } from "@/server/events";
import { EDGE_CACHE_SHORT, json, parseWith, route } from "@/server/http";

/**
 * GET /api/events/suggest?q=&city= (D-042, D-047). Public.
 * - `q` with text: `{ results, artists, cities, filters, fallback?, didYouMean? }`.
 * - `q` missing or empty: `{ sections: [{ id, title, items? | queries? }] }`; `city` adds "Near you".
 * 400 `validation_failed` for a 1-character or >100-character `q`, or unknown parameters.
 * Cached at the edge per URL (D-086): suggest runs on every keystroke and reads no cookies.
 */
export const GET = route(async (req: Request) => {
  const params = parseWith(SuggestParamsSchema, Object.fromEntries(new URL(req.url).searchParams));
  return json(await events().suggest(params), 200, EDGE_CACHE_SHORT);
});

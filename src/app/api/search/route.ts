import { SearchPageParamsSchema } from "@/application/events";
import { events } from "@/server/events";
import { json, parseWith, route } from "@/server/http";

/**
 * GET /api/search?q=&city=&artist=&from=&to=&type=&page=&pageSize= (D-048). Public.
 * The full results page: same engine and groups as suggest, plus `total`, `page`, `pageSize`.
 * `city` and `artist` are explicit filters. 400 when nothing at all is given.
 */
export const GET = route(async (req: Request) => {
  const params = parseWith(
    SearchPageParamsSchema,
    Object.fromEntries(new URL(req.url).searchParams),
  );
  return json(await events().searchPage(params));
});

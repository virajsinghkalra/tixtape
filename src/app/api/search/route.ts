import { SearchPageParamsSchema } from "@/application/events";
import { noteVisitorDemand } from "@/server/demand";
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
  if (params.q) await noteVisitorDemand("search"); // D-081: city-level count only.
  return json(await events().searchPage(params));
});

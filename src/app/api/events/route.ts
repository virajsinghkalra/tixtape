import { ListEventsQuerySchema } from "@/application/events";
import { events } from "@/server/events";
import { json, parseWith, route } from "@/server/http";

/** GET /api/events?city=&from=&to=&q=&type=&page=&pageSize= (LLD §9). Public. */
export const GET = route(async (req: Request) => {
  const query = parseWith(ListEventsQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
  const page = await events().listEvents(query);
  return json({ events: page.items, page: page.page, pageSize: page.pageSize, total: page.total });
});

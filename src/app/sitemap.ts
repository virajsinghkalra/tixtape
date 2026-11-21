import type { MetadataRoute } from "next";
import { SITE_URL as SITE } from "@/lib/site";
import { ListEventsQuerySchema } from "@/application/events";
import { withTimeout } from "@/lib/timeout";
import { events } from "@/server/events";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

/** D-084 (UX plan #13): home, search and every published upcoming event. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixed: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE}/search`, changeFrequency: "daily", priority: 0.5 },
  ];
  const upcoming = await withTimeout(upcomingEventIds(), 8000, []);
  return [
    ...fixed,
    ...upcoming.map((id) => ({
      url: `${SITE}/events/${id}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

async function upcomingEventIds(): Promise<string[]> {
  const ids: string[] = [];
  const from = new Date().toISOString();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await events().listEvents(
      ListEventsQuerySchema.parse({ from, page: String(page), pageSize: String(PAGE_SIZE) }),
    );
    ids.push(...list.items.map((e) => e.id));
    if (page * PAGE_SIZE >= list.total) break;
  }
  return ids;
}

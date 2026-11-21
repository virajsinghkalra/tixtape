/** The ranked home page (D-079): one feed read, then the pure ranking in the domain. */
import type { EventFeedReader, FeedRow } from "@/application/ports/event-feed";
import { buildFrontPage, type FrontPage } from "@/domain/events/front-page";

/** Enough to rank a whole season (~200 events) without paging. */
export const FEED_LIMIT = 300;

export async function loadFrontPage(
  feed: EventFeedReader,
  opts: { now: Date; city: string | null },
): Promise<{ rows: FeedRow[]; page: FrontPage<FeedRow> }> {
  const rows = await feed.upcoming({ from: opts.now, limit: FEED_LIMIT });
  return { rows, page: buildFrontPage(rows, opts) };
}

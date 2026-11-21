/**
 * Recommendations the server page can build from data it already has, so focusing the search
 * shows something with no spinner until `GET /api/events/suggest?q=` (D-047) is live.
 */
import type { EventSummary } from "@/application/ports/events";
import type { EventResult, RecommendationSection } from "./types";

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const MAX_ITEMS = 5;

export function toEventResult(e: EventSummary): EventResult {
  return {
    id: e.id,
    title: e.title,
    type: e.type,
    startsAt: e.startsAt.toISOString(),
    startsAtDateOnly: false,
    city: e.venue?.city ?? null,
    venueName: e.venue?.name ?? null,
    matchReason: "title",
    matchedText: "",
  };
}

/** The IST Friday 00:00 to Sunday 23:59 that is current or next. */
export function weekendRange(now: Date): { from: Date; to: Date } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0 Sun … 6 Sat
  const daysToFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const from = new Date(midnight + daysToFriday * DAY_MS - IST_OFFSET_MS);
  return { from, to: new Date(from.getTime() + 3 * DAY_MS - 1) };
}

/** "This weekend" (if any) and "Up next", each event once. */
export function localSections(
  upcoming: readonly EventSummary[],
  now: Date,
): RecommendationSection[] {
  const { from, to } = weekendRange(now);
  const weekend = upcoming
    .filter((e) => e.startsAt >= from && e.startsAt <= to)
    .slice(0, MAX_ITEMS);
  const shown = new Set(weekend.map((e) => e.id));
  const next = upcoming.filter((e) => !shown.has(e.id)).slice(0, MAX_ITEMS);
  const sections: RecommendationSection[] = [];
  if (weekend.length > 0)
    sections.push({ id: "this_weekend", title: "This weekend", items: weekend.map(toEventResult) });
  if (next.length > 0)
    sections.push({ id: "up_next", title: "Up next", items: next.map(toEventResult) });
  return sections;
}

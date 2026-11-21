/**
 * Shortcuts in the empty search sheet (UX #11, D-088): date chips and city chips. Pure.
 * Dates are IST calendar windows, linked to the full results page (`/search?from=&to=`).
 */
import { dayWindow, istDay, monthWindow, weekendWindow } from "@/domain/events/ist-calendar";
import { COPY } from "../ux-copy";
import { cityHref } from "./search-view";
import type { RecommendationSection } from "./types";

export type QuickChip = { key: string; emoji: string; label: string; href: string };

const range = (from: Date, to: Date) =>
  `/search?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`;

/** Tonight (now → end of today), This weekend (Fri–Sun, from now), This month (now → month end). */
export function dateChips(now: Date): QuickChip[] {
  const today = dayWindow(now, 0);
  const weekend = weekendWindow(now);
  const d = istDay(now);
  const month = monthWindow(d.year, d.month);
  const later = (t: Date) => (t.getTime() > now.getTime() ? t : now);
  return [
    { key: "tonight", emoji: "🌙", label: COPY.tonight, href: range(now, today.to) },
    {
      key: "weekend",
      emoji: "📅",
      label: COPY.thisWeekend,
      href: range(later(weekend.from), weekend.to),
    },
    { key: "month", emoji: "🗓️", label: COPY.thisMonth, href: range(now, month.to) },
  ];
}

/** Up to 4 cities seen in the recommendations, most shows first; the visitor's city leads. */
export function cityChips(
  sections: readonly RecommendationSection[],
  current: string | null,
  max = 4,
): QuickChip[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of sections.flatMap((s) => s.items ?? [])) {
    if (!e.city || seen.has(e.id)) continue;
    seen.add(e.id);
    counts.set(e.city, (counts.get(e.city) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([city]) => city);
  const cities = current ? [current, ...ranked.filter((c) => c !== current)] : ranked;
  return cities
    .slice(0, max)
    .map((city) => ({ key: `city:${city}`, emoji: "📍", label: city, href: cityHref(city) }));
}

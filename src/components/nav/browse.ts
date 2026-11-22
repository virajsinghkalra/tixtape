/** Pure selection for the /ready, /week and /upcoming pages (and the home "ready first" order). */
import { metroOf } from "@/domain/events/front-page";

const WEEK_MS = 7 * 86_400_000;

type Row = { startsAt: Date; playlistUrl: string | null; city: string | null };

const soonest = <T extends Row>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

/** Shows with a playlist to play right now, soonest first. */
export const readyShows = <T extends Row>(rows: readonly T[]): T[] =>
  soonest(rows.filter((r) => r.playlistUrl !== null));

/** Shows starting within the next 7 days (or already on), soonest first. */
export const weekShows = <T extends Row>(rows: readonly T[], now: Date): T[] =>
  soonest(rows.filter((r) => r.startsAt.getTime() - now.getTime() < WEEK_MS));

/** Shows starting after the next 7 days, soonest first. */
export const laterShows = <T extends Row>(rows: readonly T[], now: Date): T[] =>
  soonest(rows.filter((r) => r.startsAt.getTime() - now.getTime() >= WEEK_MS));

/** Splits into the visitor's city (same metro counts) and the rest; order kept. */
export function splitByCity<T extends Row>(
  rows: readonly T[],
  city: string | null,
): { here: T[]; other: T[] } {
  if (!city) return { here: [], other: [...rows] };
  const metro = metroOf(city);
  const here = rows.filter((r) => r.city && metroOf(r.city) === metro);
  return { here, other: rows.filter((r) => !here.includes(r)) };
}

/** Stable: ready-to-play first, each group keeping its order. */
export const readyFirst = <T extends { playlistUrl: string | null }>(items: readonly T[]): T[] => [
  ...items.filter((i) => i.playlistUrl !== null),
  ...items.filter((i) => i.playlistUrl === null),
];

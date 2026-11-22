/**
 * Calendar windows in India Standard Time (UTC+05:30, no DST) for date words in search
 * ("tonight", "this weekend", "december"). Each window is [from, to] with `to` inclusive.
 */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type DateWindow = { from: Date; to: Date };

type IstDay = { year: number; month: number; day: number; weekday: number };

/** The IST calendar date of an instant. `month` is 0-based; `weekday` 0 = Sunday. */
export function istDay(at: Date): IstDay {
  const wall = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
  };
}

/** 00:00 IST on the given calendar date (overflowing days/months roll over, like Date.UTC). */
export function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

const span = (from: Date, days: number): DateWindow => ({
  from,
  to: new Date(from.getTime() + days * DAY_MS - 1),
});

export function dayWindow(now: Date, offsetDays: number): DateWindow {
  const d = istDay(now);
  return span(istMidnight(d.year, d.month, d.day + offsetDays), 1);
}

/**
 * The upcoming weekend, Friday 00:00 to Sunday 23:59:59.999 IST (QA-F-5):
 * - Monday–Thursday: the coming one.
 * - Friday or Saturday: the current one, from the start of today (days already gone aren't
 *   "this weekend").
 * - Sunday: the next one; this weekend is all but over.
 * `weeksAhead` 1 gives "next weekend", the full Friday–Sunday after that.
 */
export function weekendWindow(now: Date, weeksAhead = 0): DateWindow {
  const d = istDay(now);
  const sinceFriday = (d.weekday + 2) % 7; // Fri 0, Sat 1, Sun 2, Mon 3 … Thu 6
  const toFriday = sinceFriday <= 1 ? -sinceFriday : 7 - sinceFriday;
  const friday = istMidnight(d.year, d.month, d.day + toFriday + 7 * weeksAhead);
  const full = span(friday, 3);
  if (weeksAhead > 0 || sinceFriday > 1) return full;
  return { from: istMidnight(d.year, d.month, d.day), to: full.to };
}

export function monthWindow(year: number, month: number): DateWindow {
  const from = istMidnight(year, month, 1);
  return { from, to: new Date(istMidnight(year, month + 1, 1).getTime() - 1) };
}

export function yearWindow(year: number): DateWindow {
  return { from: istMidnight(year, 0, 1), to: new Date(istMidnight(year + 1, 0, 1).getTime() - 1) };
}

/** The next time `month` comes round: this year if it hasn't passed, else next year. */
export function upcomingMonthWindow(now: Date, month: number): DateWindow {
  const d = istDay(now);
  return monthWindow(month >= d.month ? d.year : d.year + 1, month);
}

/**
 * When an event stops being upcoming: its `endsAt`, else (date-only, stored at 00:00 IST) the
 * end of its IST day, 23:59:59.999, else `startsAt` plus `timedGraceMs`. One rule for the home
 * feed, search and lists; the SQL twin is `eventEndSql` (src/infrastructure/db/event-time.ts).
 * Never write this back to `ends_at`: the playlist length (D-065) derives from a real end.
 */
export function eventEnd(
  e: { startsAt: Date; endsAt: Date | null; startsAtDateOnly?: boolean },
  timedGraceMs = 0,
): Date {
  if (e.endsAt) return e.endsAt;
  if (e.startsAtDateOnly) {
    const d = istDay(e.startsAt);
    return new Date(istMidnight(d.year, d.month, d.day + 1).getTime() - 1);
  }
  return new Date(e.startsAt.getTime() + timedGraceMs);
}

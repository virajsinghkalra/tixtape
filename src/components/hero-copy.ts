/**
 * Hero tile copy (D-082 minimal: 2–4 words). Pure and tested; the tiles are animated around it.
 */
import { istDayNumber, istParts } from "./event-format";

const MAX_TITLE = 32;

/**
 * The hero carousel's one source of truth: the slide at `index` (wrapping, and safe when the
 * list shrinks after a refresh). The picture, title, badge, countdown and link are all drawn
 * from this one object and keyed by its `id`, so the photo can never show one show while the
 * title shows another.
 */
export function slideAt<T extends { id: string }>(
  items: readonly T[],
  index: number,
): { slide: T; index: number } | null {
  if (items.length === 0) return null;
  const i = ((Math.trunc(index) % items.length) + items.length) % items.length;
  return { slide: items[i]!, index: i };
}

/**
 * UX #6: the hero's next shows. Among the soonest `window` upcoming shows, ready playlists come
 * first, then ones being made, then the rest; soonest first within each. Stable.
 */
export function pickNextUp<T extends { playlistStatus: "ready" | "building" | null }>(
  soonest: readonly T[],
  n = 3,
  window = 12,
): T[] {
  const rank = (t: T) =>
    t.playlistStatus === "ready" ? 0 : t.playlistStatus === "building" ? 1 : 2;
  return soonest
    .slice(0, window)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.t);
}
const MIN = 60_000;

/**
 * "Shreya Ghoshal – The Unstoppable India Tour – Bengaluru" → "Shreya Ghoshal · Bengaluru".
 * The first part (or the headliner, when the first part is a long name that includes
 * them) plus the city at the end; clipped with "…" past 32 characters.
 */
export function shortTitle(title: string, headliner?: string): string {
  const parts = title
    .split(/\s[–—-]\s/u)
    .map((p) => p.trim())
    .filter(Boolean);
  let head = parts[0] ?? title.trim();
  if (headliner && head.length > 20 && head.toLowerCase().includes(headliner.toLowerCase())) {
    head = headliner;
  }
  const city = parts.length > 1 ? parts[parts.length - 1]! : null;
  const text = city && city !== head ? `${head} · ${city}` : head;
  return text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text;
}

/**
 * A live countdown that reads at a glance: "Live now", "Tonight 🔥", "in 3h 20m", "Tomorrow",
 * "in 2d 4h", "in 12d". Date-only shows (no time known) never show hours.
 */
export function countdownLabel(
  startsAt: Date,
  endsAt: Date | null,
  now: Date,
  dateOnly = false,
): string {
  const ms = startsAt.getTime() - now.getTime();
  const days = istDayNumber(startsAt) - istDayNumber(now);
  // A date-only show is stored at 00:00 IST: it's "tonight" all day, never "live" at midnight.
  if (dateOnly && days === 0) return "Tonight 🔥";
  if (ms <= 0) {
    const on = endsAt ? endsAt.getTime() >= now.getTime() : days === 0;
    return on ? "Live now 🔴" : "Ended";
  }
  if (days === 0) {
    if (dateOnly || istParts(startsAt).hour >= 17) return "Tonight 🔥";
    const h = Math.floor(ms / (60 * MIN));
    const m = Math.floor((ms % (60 * MIN)) / MIN);
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
  if (days === 1) return "Tomorrow ⚡";
  if (dateOnly || days > 7) return `in ${days}d`;
  const h = Math.floor((ms % (24 * 60 * MIN)) / (60 * MIN));
  return `in ${Math.floor(ms / (24 * 60 * MIN))}d ${h}h`;
}

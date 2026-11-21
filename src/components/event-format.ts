/**
 * Date and time display for events. Times are stored in UTC and always shown in IST
 * (develop-web-ui skill), whatever the viewer's or server's own time zone is.
 */
const TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type DateParts = {
  weekday: string;
  day: string;
  month: string;
  year: string;
  hour: number;
  minute: number;
};

/** The event's calendar fields as seen in India. */
export function istParts(date: Date): DateParts {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    partsFormat.formatToParts(date).find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function istDayNumber(date: Date): number {
  return Math.floor((date.getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** "Sat, 23 Jan 2027", "23–24 Jan 2027", "31 Dec – 1 Jan 2027" or across years in full. */
export function formatDateRange(startsAt: Date, endsAt: Date | null): string {
  const s = istParts(startsAt);
  if (!endsAt || istDayNumber(endsAt) <= istDayNumber(startsAt)) {
    return `${s.weekday}, ${s.day} ${s.month} ${s.year}`;
  }
  const e = istParts(endsAt);
  if (s.year !== e.year) return `${s.day} ${s.month} ${s.year} – ${e.day} ${e.month} ${e.year}`;
  if (s.month !== e.month) return `${s.day} ${s.month} – ${e.day} ${e.month} ${e.year}`;
  return `${s.day}–${e.day} ${s.month} ${s.year}`;
}

/** "7:00 pm IST"; midnight IST means the source gave no time, so it reads "Time TBA". */
export function formatStartTime(startsAt: Date): string {
  const { hour, minute } = istParts(startsAt);
  if (hour === 0 && minute === 0) return "Time TBA";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix} IST`;
}

export type CountdownBadge = {
  emoji: string;
  label: string;
  tone: "pink" | "orange" | "lime" | "sky" | "surface";
  /** True while the event is on or starts today: worth a live ticking badge. */
  live: boolean;
};

/** A BeReal-style "how soon" badge, counted in IST calendar days. */
export function countdownBadge(startsAt: Date, endsAt: Date | null, now: Date): CountdownBadge {
  const days = istDayNumber(startsAt) - istDayNumber(now);
  if (days < 0) {
    const on = endsAt !== null && endsAt.getTime() >= now.getTime();
    return on
      ? { emoji: "🔴", label: "Live now", tone: "pink", live: true }
      : { emoji: "🎬", label: "Ended", tone: "surface", live: false };
  }
  if (days === 0) {
    const evening = istParts(startsAt).hour >= 17;
    return { emoji: "🔴", label: evening ? "Tonight" : "Today", tone: "pink", live: true };
  }
  if (days === 1) return { emoji: "⚡", label: "Tomorrow", tone: "orange", live: false };
  if (days < 60) return { emoji: "⏰", label: `${days} days to go`, tone: "lime", live: false };
  return { emoji: "📅", label: `In ${Math.round(days / 30)} months`, tone: "sky", live: false };
}

/** How many IST calendar days a show spans (1 for a single night). */
export function istDayCount(startsAt: Date, endsAt: Date | null): number {
  if (!endsAt) return 1;
  return Math.max(1, istDayNumber(endsAt) - istDayNumber(startsAt) + 1);
}

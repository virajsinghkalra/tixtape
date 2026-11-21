/**
 * The real performance time of an event, summed over its days (D-065). Pure.
 * Sources, best first: verified hours text ("14:00-22:00 IST each day"), start/end times,
 * then defaults (festival 8 h a day, single-artist concert 2 h 30 m, multi-artist concert 4 h).
 */
import type { EventType } from "@/domain/shared/lineup";

export const DEFAULT_SHOW_MINUTES = {
  festivalDay: 8 * 60,
  singleArtistConcert: 150,
  multiArtistConcert: 4 * 60,
} as const;

/** India Standard Time: the beta's events are in India (UTC+5:30). */
export const IST_OFFSET_MINUTES = 330;
const MAX_DAYS = 14;
const MIN_DAY_MINUTES = 30;
/** Up to this long from start to end counts as a single day's show. */
const ONE_NIGHT_MINUTES = 18 * 60;
const DAY_MINUTES = 24 * 60;

export type ShowLength = {
  minutes: number;
  days: number;
  minutesPerDay: number;
  source: "hours" | "times" | "default";
};

export type ShowLengthInput = {
  type: EventType;
  startsAt: Date;
  endsAt: Date | null;
  /** Verified daily hours, e.g. "14:00-22:00 IST each day" or "2pm – 10pm". */
  hours?: string | null;
  isSingleArtist: boolean;
  utcOffsetMinutes?: number;
};

const HOURS_RANGE =
  /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/iu;

function clockMinutes(h: string, m: string | undefined, ampm: string | undefined): number | null {
  let hour = Number(h);
  const minute = m === undefined ? 0 : Number(m);
  if (hour > 24 || minute > 59) return null;
  const suffix = ampm?.toLowerCase();
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** Minutes per day from an hours range; an end at or before the start runs past midnight. */
export function parseDailyHours(text: string): number | null {
  const m = HOURS_RANGE.exec(text);
  if (!m) return null;
  const start = clockMinutes(m[1]!, m[2], m[3] ?? m[6]);
  const end = clockMinutes(m[4]!, m[5], m[6]);
  if (start === null || end === null) return null;
  const span = end > start ? end - start : end + DAY_MINUTES - start;
  return span >= MIN_DAY_MINUTES ? span : null;
}

const localMinutes = (d: Date, offset: number) => d.getTime() / 60_000 + offset;
const localDay = (d: Date, offset: number) => Math.floor(localMinutes(d, offset) / DAY_MINUTES);
const timeOfDay = (d: Date, offset: number) =>
  ((localMinutes(d, offset) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;

/**
 * A one-artist show is a single set whatever the event type: "Johnnie & Co. Music Festival"
 * with only Charlie Puth billed gets 2 h 30 m, not a festival day (D-085).
 */
function defaultPerDay(input: ShowLengthInput): number {
  if (input.isSingleArtist) return DEFAULT_SHOW_MINUTES.singleArtistConcert;
  return input.type === "festival"
    ? DEFAULT_SHOW_MINUTES.festivalDay
    : DEFAULT_SHOW_MINUTES.multiArtistConcert;
}

/** Per-day minutes from start/end times, or null when they don't say. */
function perDayFromTimes(input: ShowLengthInput, days: number, offset: number): number | null {
  const { startsAt, endsAt } = input;
  if (!endsAt || endsAt <= startsAt) return null;
  if (days === 1) {
    const span = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    return span >= MIN_DAY_MINUTES ? span : null;
  }
  // Multi-day: the same daily window, from the first day's start time to the last day's end.
  const span = timeOfDay(endsAt, offset) - timeOfDay(startsAt, offset);
  return span >= MIN_DAY_MINUTES ? span : null;
}

export function eventPerformanceMinutes(input: ShowLengthInput): ShowLength {
  const offset = input.utcOffsetMinutes ?? IST_OFFSET_MINUTES;
  const spanMinutes = input.endsAt
    ? (input.endsAt.getTime() - input.startsAt.getTime()) / 60_000
    : 0;
  // A show that runs past midnight (19:00–01:00) is still one day.
  const days =
    spanMinutes > ONE_NIGHT_MINUTES && input.endsAt
      ? Math.min(MAX_DAYS, localDay(input.endsAt, offset) - localDay(input.startsAt, offset) + 1)
      : 1;
  const fromHours = input.hours ? parseDailyHours(input.hours) : null;
  const fromTimes = fromHours === null ? perDayFromTimes(input, days, offset) : null;
  const minutesPerDay = fromHours ?? fromTimes ?? defaultPerDay(input);
  const source = fromHours !== null ? "hours" : fromTimes !== null ? "times" : "default";
  return { minutes: Math.round(minutesPerDay * days), days, minutesPerDay, source };
}

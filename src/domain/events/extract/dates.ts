/**
 * Event dates in free text (P1.11), read as India Standard Time calendar dates.
 * Handles "Feb. 13, 2027", "13 February 2027", "Dec 12–13", "12th & 13th December 2026",
 * "December 18th and 19th, 2026", "29th–30th December, 2026", "29 November – 1 December".
 * Years are never guessed unless the caller allows it (`inferYear`, articles only): then a
 * missing year is the first one in which the date isn't before the reference date (the
 * article's publish date). A date is never moved forward relative to "now"; callers drop
 * past dates (D-053 data-quality fix).
 */
import { istDay, istMidnight } from "../ist-calendar";

export type DateRange = {
  /** 00:00 IST on the first day. */
  start: Date;
  /** 00:00 IST on the last day, or null for a one-day event. */
  end: Date | null;
  /** False when the year was inferred. */
  yearGiven: boolean;
  /** Where the date starts in the text. */
  index: number;
};

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const JOIN = String.raw`\s*(?:–|—|-|to|&|and)\s*`;
const YEAR = String.raw`(?:,?\s+(\d{4}))?`;

/** "29 November – 1 December 2026" */
const CROSS_MONTH_DAY_FIRST = new RegExp(
  String.raw`\b${DAY}\s+${MONTH}${JOIN}${DAY}\s+${MONTH}${YEAR}\b`,
  "giu",
);
/** "November 29 – December 1, 2026" */
const CROSS_MONTH_MONTH_FIRST = new RegExp(
  String.raw`\b${MONTH}\s+${DAY}${JOIN}${MONTH}\s+${DAY}${YEAR}\b`,
  "giu",
);
/** "12th & 13th December 2026", "13 February", "1-2 November" */
const DAY_FIRST = new RegExp(
  String.raw`\b${DAY}(?:${JOIN}${DAY})?\s+(?:of\s+)?${MONTH}${YEAR}\b`,
  "giu",
);
/** "Feb. 13, 2027", "Dec 12–13", "December 18th and 19th, 2026" */
const MONTH_FIRST = new RegExp(String.raw`\b${MONTH}\s+${DAY}(?:${JOIN}${DAY})?${YEAR}\b`, "giu");

type Parts = {
  index: number;
  startDay: number;
  startMonth: number;
  endDay: number | null;
  endMonth: number | null;
  year: number | null;
};

/** Month names are capitalised in prose; "it may 2 be" is not a date. */
const month = (s: string | undefined) =>
  s === undefined || !/^\p{Lu}/u.test(s) ? -1 : (MONTHS[s.toLowerCase()] ?? -1);
const num = (s: string | undefined) => (s === undefined ? null : Number(s));

function matches(text: string): Parts[] {
  const found: Parts[] = [];
  const taken: Array<[number, number]> = [];
  const add = (m: RegExpExecArray, p: Omit<Parts, "index">) => {
    const end = m.index + m[0].length;
    if (taken.some(([a, b]) => m.index < b && end > a)) return;
    taken.push([m.index, end]);
    found.push({ index: m.index, ...p });
  };
  for (const m of text.matchAll(CROSS_MONTH_DAY_FIRST))
    add(m, {
      startDay: Number(m[1]),
      startMonth: month(m[2]),
      endDay: Number(m[3]),
      endMonth: month(m[4]),
      year: num(m[5]),
    });
  for (const m of text.matchAll(CROSS_MONTH_MONTH_FIRST))
    add(m, {
      startMonth: month(m[1]),
      startDay: Number(m[2]),
      endMonth: month(m[3]),
      endDay: Number(m[4]),
      year: num(m[5]),
    });
  for (const m of text.matchAll(DAY_FIRST))
    add(m, {
      startDay: Number(m[1]),
      endDay: num(m[2]),
      startMonth: month(m[3]),
      endMonth: null,
      year: num(m[4]),
    });
  for (const m of text.matchAll(MONTH_FIRST))
    add(m, {
      startMonth: month(m[1]),
      startDay: Number(m[2]),
      endDay: num(m[3]),
      endMonth: null,
      year: num(m[4]),
    });
  return found.sort((a, b) => a.index - b.index);
}

const daysIn = (year: number, m: number) => new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
const valid = (year: number, m: number, d: number) => m >= 0 && d >= 1 && d <= daysIn(year, m);

/** How far in the past an undated-year date may be and still mean this year (a festival in progress). */
const GRACE_DAYS = 7;

export type DateOptions = {
  /** Read a year-less date relative to `reference` (articles). Default false: drop it. */
  inferYear?: boolean;
};

function toRange(p: Parts, reference: Date, opts: DateOptions): DateRange | null {
  if (p.year === null && !opts.inferYear) return null;
  const endMonth = p.endMonth ?? p.startMonth;
  let year = p.year ?? istDay(reference).year;
  if (p.year === null) {
    const graceStart = reference.getTime() - GRACE_DAYS * 86_400_000;
    if (istMidnight(year, p.startMonth, p.startDay).getTime() < graceStart) year++;
  }
  // "29 December – 2 January 2027": the start is in the year before the stated one.
  const startYear = endMonth < p.startMonth && p.year !== null ? year - 1 : year;
  const endYear = endMonth < p.startMonth && p.year === null ? year + 1 : year;
  if (!valid(startYear, p.startMonth, p.startDay)) return null;
  const start = istMidnight(startYear, p.startMonth, p.startDay);
  let end: Date | null = null;
  if (p.endDay !== null) {
    if (!valid(endYear, endMonth, p.endDay)) return null;
    end = istMidnight(endYear, endMonth, p.endDay);
    if (end.getTime() <= start.getTime()) return null;
    if (end.getTime() - start.getTime() > 31 * 86_400_000) return null;
  }
  return { start, end, yearGiven: p.year !== null, index: p.index };
}

/** Every date or date range in the text, in reading order. */
export function findDateRanges(text: string, reference: Date, opts: DateOptions = {}): DateRange[] {
  return matches(text).flatMap((p) => {
    const r = toRange(p, reference, opts);
    return r ? [r] : [];
  });
}

/** The first date range in the text, or null. */
export function parseDateRange(
  text: string,
  reference: Date,
  opts: DateOptions = {},
): DateRange | null {
  return findDateRanges(text, reference, opts)[0] ?? null;
}

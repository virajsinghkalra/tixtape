/**
 * Show dates and start times in page text (D-073). Stricter than the article date reader:
 * - **the year must be written out** (four digits) in the same phrase: nothing is inferred,
 *   because the 2025-vs-2027 failure came from a guessed year (D-054);
 * - **a list of days is a list of nights**: "5th, 6th and 9th December 2026" is three shows,
 *   never the range 5–9 December. A listing range ("Sat 5 Dec 2026 – Wed 9 Dec 2026") stays a
 *   range: it doesn't say which nights are shows, so it can't be split;
 * - every mention keeps its exact text span (`quote`) for grounding.
 * Dates are 00:00 IST, the convention for stored events.
 */
import { istMidnight } from "../events/ist-calendar";

export type DateMention =
  | { kind: "nights"; nights: Date[]; quote: string; index: number }
  | { kind: "range"; start: Date; end: Date; quote: string; index: number };

export type ShowTime = { hhmm: string; quote: string };

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const MONTH = String.raw`((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const DAY_NC = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const WEEKDAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?`;
const YEAR = String.raw`(20\d{2})`;
const LIST_SEP = String.raw`(?:\s*,\s*(?:and\s+|&\s*)?|\s+and\s+|\s*&\s*)`;
const RANGE_SEP = String.raw`\s*(?:–|—|-|to|till|until)\s*`;

/** "5 Dec 2026 – 9 Dec 2026", "Sat 5 Dec 2026 - Wed 9 Dec 2026", "29 Nov – 1 Dec 2026". */
const RANGE_DAY_FIRST = new RegExp(
  String.raw`\b${WEEKDAY}${DAY}\s+${MONTH}(?:,?\s+${YEAR})?${RANGE_SEP}${WEEKDAY}${DAY}\s+${MONTH},?\s+${YEAR}\b`,
  "giu",
);
/** "5–9 December 2026". */
const RANGE_SAME_MONTH = new RegExp(
  String.raw`\b${DAY}${RANGE_SEP}${DAY}\s+${MONTH},?\s+${YEAR}\b`,
  "giu",
);
/** "December 5 – 9, 2026". */
const RANGE_MONTH_FIRST = new RegExp(
  String.raw`\b${MONTH}\s+${DAY}${RANGE_SEP}${DAY},?\s+${YEAR}\b`,
  "giu",
);
/** "5th, 6th and 9th December 2026", "Sat 5 Dec 2026", "05th, 06th & 09th December 2026". */
const LIST_DAY_FIRST = new RegExp(
  String.raw`\b${WEEKDAY}(${DAY_NC}(?:${LIST_SEP}${DAY_NC})*)\s+(?:of\s+)?${MONTH},?\s+${YEAR}\b`,
  "giu",
);
/** "December 5, 6 and 9, 2026", "Dec 5, 2026". */
const LIST_MONTH_FIRST = new RegExp(
  String.raw`\b${WEEKDAY}${MONTH}\s+(${DAY_NC}(?:${LIST_SEP}${DAY_NC})*),?\s+${YEAR}\b`,
  "giu",
);
/** "05.12.2026", "5/12/2026" (day first, as written in India; four-digit year only). */
const NUMERIC = /\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/gu;

function monthOf(word: string | undefined): number {
  if (!word) return -1;
  // "may" and "mar" are ordinary words in prose; only capitalised forms are months.
  const key = word.slice(0, 3).toLowerCase();
  if ((key === "may" || key === "mar") && !/^\p{Lu}/u.test(word)) return -1;
  const full = word.toLowerCase();
  const m = MONTHS[key];
  if (m === undefined) return -1;
  // Accept "dec", "december", "decem" is not a month.
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  return full.length === 3 || full === names[m] || (m === 8 && full === "sept") ? m : -1;
}

const daysIn = (year: number, m: number) => new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
const day = (year: number, month: number, d: number): Date | null =>
  month >= 0 && d >= 1 && d <= daysIn(year, month) ? istMidnight(year, month, d) : null;
const MAX_RANGE_MS = 31 * 86_400_000;

/** Every explicit-year date mention in reading order, each with its exact text span. */
export function findDateMentions(text: string): DateMention[] {
  const out: DateMention[] = [];
  const taken: Array<[number, number]> = [];
  const claim = (m: RegExpExecArray): boolean => {
    const end = m.index + m[0].length;
    if (taken.some(([a, b]) => m.index < b && end > a)) return false;
    taken.push([m.index, end]);
    return true;
  };
  const range = (m: RegExpExecArray, start: Date | null, end: Date | null) => {
    // An impossible or season-long range is still claimed, so its ends aren't read as nights.
    if (!claim(m)) return;
    if (!start || !end || end <= start || end.getTime() - start.getTime() > MAX_RANGE_MS) return;
    out.push({ kind: "range", start, end, quote: m[0].trim(), index: m.index });
  };
  for (const m of text.matchAll(RANGE_DAY_FIRST)) {
    const endYear = Number(m[6]);
    const startMonth = monthOf(m[2]);
    const endMonth = monthOf(m[5]);
    const startYear = m[3] ? Number(m[3]) : startMonth > endMonth ? endYear - 1 : endYear;
    range(m, day(startYear, startMonth, Number(m[1])), day(endYear, endMonth, Number(m[4])));
  }
  for (const m of text.matchAll(RANGE_SAME_MONTH)) {
    const month = monthOf(m[3]);
    const year = Number(m[4]);
    range(m, day(year, month, Number(m[1])), day(year, month, Number(m[2])));
  }
  for (const m of text.matchAll(RANGE_MONTH_FIRST)) {
    const month = monthOf(m[1]);
    const year = Number(m[4]);
    range(m, day(year, month, Number(m[2])), day(year, month, Number(m[3])));
  }
  const nights = (m: RegExpExecArray, days: string, month: number, year: number) => {
    const dates = (days.match(/\d{1,2}/gu) ?? []).map((d) => day(year, month, Number(d)));
    if (dates.length === 0 || dates.some((d) => d === null)) return;
    const unique = [...new Map(dates.map((d) => [d!.getTime(), d!])).values()];
    if (claim(m)) {
      out.push({
        kind: "nights",
        nights: unique.sort((a, b) => a.getTime() - b.getTime()),
        quote: m[0].trim(),
        index: m.index,
      });
    }
  };
  for (const m of text.matchAll(LIST_DAY_FIRST)) nights(m, m[1]!, monthOf(m[2]), Number(m[3]));
  for (const m of text.matchAll(LIST_MONTH_FIRST)) nights(m, m[2]!, monthOf(m[1]), Number(m[3]));
  for (const m of text.matchAll(NUMERIC)) {
    const d = day(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (d && claim(m)) out.push({ kind: "nights", nights: [d], quote: m[0], index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

const TIME_12H = /\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*([ap])\.?\s?m\b\.?/iu;
const TIME_24H = /\b([01]\d|2[0-3]):([0-5]\d)\s*(?:hrs|hours|h)?\b/iu;

/** The first show time in the text ("7:30 PM", "8PM", "19:30 hrs"), as 24-hour "HH:MM". */
export function findShowTime(text: string): ShowTime | null {
  const twelve = TIME_12H.exec(text);
  if (twelve) {
    let h = Number(twelve[1]) % 12;
    if (twelve[3]!.toLowerCase() === "p") h += 12;
    const hhmm = `${String(h).padStart(2, "0")}:${twelve[2] ?? "00"}`;
    return { hhmm, quote: twelve[0].trim() };
  }
  const day24 = TIME_24H.exec(text);
  if (day24) return { hhmm: `${day24[1]}:${day24[2]}`, quote: day24[0].trim() };
  return null;
}

/** 00:00 IST on `night` plus an "HH:MM" IST start time. */
export function atIstTime(night: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(night.getTime() + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
}

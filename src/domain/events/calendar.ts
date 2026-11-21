/**
 * "Remind me" (UX #2, D-088): an iCalendar file and a Google Calendar link for one event.
 * Pure: the caller passes `now` (DTSTAMP) and the absolute event URL.
 *
 * Time zones: timed shows are written in UTC (`…Z`), so every calendar shows the right local
 * time with no VTIMEZONE block. Date-only shows (D-034: stored at 00:00 IST) become all-day
 * events on their IST calendar dates, so a viewer abroad never sees them slide to the day before.
 */
import { istDay, istMidnight } from "./ist-calendar";

const HOUR_MS = 3_600_000;
/** A concert with no stated end: a 4-hour block. */
const DEFAULT_SHOW_MS = 4 * HOUR_MS;

export type CalendarEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  /** D-034: only the date is known. */
  dateOnly: boolean;
  festival: boolean;
  /** "Venue, City", or null when the venue isn't known. */
  location: string | null;
  /** The event page, absolute. */
  url: string;
};

/** D-034 stores date-only shows at 00:00 IST; the UI already reads that as "Time TBA". */
export function startsAtIstMidnight(startsAt: Date): boolean {
  const d = istDay(startsAt);
  return istMidnight(d.year, d.month, d.day).getTime() === startsAt.getTime();
}

/** The event fields a reminder needs (a published event, structurally). */
export type RemindableEvent = {
  id: string;
  title: string;
  type: string;
  startsAt: Date;
  endsAt: Date | null;
  startsAtDateOnly?: boolean;
  venue: { name: string; city: string } | null;
};

/** `origin` is the site's absolute origin, e.g. https://tixtape.vercel.app. */
export function calendarEventOf(e: RemindableEvent, origin: string): CalendarEvent {
  return {
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    dateOnly: e.startsAtDateOnly ?? startsAtIstMidnight(e.startsAt),
    festival: e.type === "festival",
    location: e.venue ? `${e.venue.name}, ${e.venue.city}` : null,
    url: `${origin}/events/${e.id}`,
  };
}

type Span =
  | { allDay: true; startDate: string; endDateExclusive: string }
  | { allDay: false; start: Date; end: Date };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function istDate(at: Date, plusDays = 0): string {
  const d = istDay(at);
  const day = istDay(istMidnight(d.year, d.month, d.day + plusDays));
  return `${day.year}${pad(day.month + 1)}${pad(day.day)}`;
}

function utcStamp(at: Date): string {
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** When the event runs, as calendars want it. */
export function calendarSpan(e: CalendarEvent): Span {
  const end = e.endsAt && e.endsAt.getTime() > e.startsAt.getTime() ? e.endsAt : null;
  if (e.dateOnly) {
    // All-day: DTEND is the day after the last day (RFC 5545 §3.6.1).
    return {
      allDay: true,
      startDate: istDate(e.startsAt),
      endDateExclusive: istDate(end ?? e.startsAt, 1),
    };
  }
  if (end) return { allDay: false, start: e.startsAt, end };
  if (e.festival) {
    // A festival day with no stated end runs to the end of its IST day.
    const d = istDay(e.startsAt);
    return { allDay: false, start: e.startsAt, end: istMidnight(d.year, d.month, d.day + 1) };
  }
  return {
    allDay: false,
    start: e.startsAt,
    end: new Date(e.startsAt.getTime() + DEFAULT_SHOW_MS),
  };
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space, never inside a character. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const alarm = (trigger: string, title: string) => [
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  `DESCRIPTION:${escapeIcsText(title)}`,
  `TRIGGER:${trigger}`,
  "END:VALARM",
];

/**
 * A one-event VCALENDAR. The UID is stable per event, so adding it again after a time or lineup
 * change updates the entry instead of duplicating it. Alarms: a day before and 3 hours before.
 */
export function buildIcs(e: CalendarEvent, now: Date): string {
  const span = calendarSpan(e);
  const when = span.allDay
    ? [`DTSTART;VALUE=DATE:${span.startDate}`, `DTEND;VALUE=DATE:${span.endDateExclusive}`]
    : [`DTSTART:${utcStamp(span.start)}`, `DTEND:${utcStamp(span.end)}`];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tixtape//Remind me//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@tixtape`,
    `DTSTAMP:${utcStamp(now)}`,
    ...when,
    `SUMMARY:${escapeIcsText(e.title)}`,
    ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []),
    `URL:${e.url}`,
    `DESCRIPTION:${escapeIcsText(`Playlist: ${e.url}#playlist`)}`,
    ...alarm("-P1D", e.title),
    ...alarm("-PT3H", e.title),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Google Calendar's "add event" template link (works in Android and in-app browsers). */
export function googleCalendarUrl(e: CalendarEvent): string {
  const span = calendarSpan(e);
  const dates = span.allDay
    ? `${span.startDate}/${span.endDateExclusive}`
    : `${utcStamp(span.start)}/${utcStamp(span.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates,
    details: `Playlist: ${e.url}#playlist`,
    ...(e.location ? { location: e.location } : {}),
    ctz: "Asia/Kolkata",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** "sunburn-arena-ft-alan-walker.ics": ASCII only, never empty. */
export function icsFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "tixtape-show"}.ics`;
}

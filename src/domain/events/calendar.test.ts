import { describe, expect, it } from "vitest";
import {
  buildIcs,
  calendarEventOf,
  calendarSpan,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsFileName,
  startsAtIstMidnight,
  type CalendarEvent,
} from "./calendar";

const NOW = new Date("2026-11-22T10:00:00Z");

const base: CalendarEvent = {
  id: "248b0000-0000-4000-8000-000000000001",
  title: "Sunburn Arena ft. Alan Walker",
  // 7:00 pm IST on 19 Dec
  startsAt: new Date("2026-12-19T13:30:00Z"),
  endsAt: null,
  dateOnly: false,
  festival: false,
  location: "NSCI Dome, Mumbai",
  url: "https://tixtape.vercel.app/events/248b0000-0000-4000-8000-000000000001",
};

const lines = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("startsAtIstMidnight", () => {
  it.each([
    ["2026-12-18T18:30:00Z", true], // 00:00 IST on 19 Dec
    ["2026-12-19T13:30:00Z", false],
    ["2026-12-19T00:00:00Z", false], // 05:30 IST
  ])("%s → %s", (iso, expected) => {
    expect(startsAtIstMidnight(new Date(iso))).toBe(expected);
  });
});

describe("calendarSpan", () => {
  it("a timed concert with no end runs 4 hours, in UTC", () => {
    const s = calendarSpan(base);
    expect(s).toEqual({
      allDay: false,
      start: new Date("2026-12-19T13:30:00Z"),
      end: new Date("2026-12-19T17:30:00Z"),
    });
  });

  it("uses a real end when there is one", () => {
    const end = new Date("2026-12-19T18:00:00Z");
    expect(calendarSpan({ ...base, endsAt: end })).toMatchObject({ allDay: false, end });
  });

  it("ignores an end that isn't after the start", () => {
    expect(calendarSpan({ ...base, endsAt: base.startsAt })).toMatchObject({
      end: new Date("2026-12-19T17:30:00Z"),
    });
  });

  it("a timed festival day with no end runs to IST midnight", () => {
    expect(calendarSpan({ ...base, festival: true })).toMatchObject({
      end: new Date("2026-12-19T18:30:00Z"),
    });
  });

  it("a date-only show is all day on its IST date (not the UTC date before)", () => {
    const s = calendarSpan({ ...base, dateOnly: true, startsAt: new Date("2026-12-18T18:30:00Z") });
    expect(s).toEqual({ allDay: true, startDate: "20261219", endDateExclusive: "20261220" });
  });

  it("a date-only multi-day festival spans every day, end exclusive", () => {
    const s = calendarSpan({
      ...base,
      dateOnly: true,
      festival: true,
      startsAt: new Date("2026-12-18T18:30:00Z"), // 19 Dec IST
      endsAt: new Date("2026-12-20T18:30:00Z"), // 21 Dec IST
    });
    expect(s).toEqual({ allDay: true, startDate: "20261219", endDateExclusive: "20261222" });
  });

  it("rolls over month and year ends", () => {
    const s = calendarSpan({ ...base, dateOnly: true, startsAt: new Date("2026-12-30T18:30:00Z") });
    expect(s).toEqual({ allDay: true, startDate: "20261231", endDateExclusive: "20270101" });
  });
});

describe("buildIcs", () => {
  it("writes one VEVENT with a stable UID, UTC times and two alarms", () => {
    const ics = buildIcs(base, NOW);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/); // CRLF only
    const l = lines(ics);
    expect(l).toContain("BEGIN:VCALENDAR");
    expect(l).toContain("VERSION:2.0");
    expect(l).toContain(`UID:${base.id}@tixtape`);
    expect(l).toContain("DTSTAMP:20261122T100000Z");
    expect(l).toContain("DTSTART:20261219T133000Z");
    expect(l).toContain("DTEND:20261219T173000Z");
    expect(l).toContain("SUMMARY:Sunburn Arena ft. Alan Walker");
    expect(l).toContain("LOCATION:NSCI Dome\\, Mumbai");
    expect(l).toContain(`URL:${base.url}`);
    expect(l).toContain(`DESCRIPTION:Playlist: ${base.url}#playlist`);
    expect(l.filter((x) => x === "BEGIN:VALARM")).toHaveLength(2);
    expect(l).toContain("TRIGGER:-P1D");
    expect(l).toContain("TRIGGER:-PT3H");
    expect(l.at(-2)).toBe("END:VCALENDAR");
  });

  it("writes all-day dates for a date-only show", () => {
    const l = lines(
      buildIcs({ ...base, dateOnly: true, startsAt: new Date("2026-12-18T18:30:00Z") }, NOW),
    );
    expect(l).toContain("DTSTART;VALUE=DATE:20261219");
    expect(l).toContain("DTEND;VALUE=DATE:20261220");
  });

  it("omits LOCATION when the venue is unknown", () => {
    expect(buildIcs({ ...base, location: null }, NOW)).not.toContain("LOCATION:");
  });

  it("keeps every physical line within 75 octets", () => {
    const ics = buildIcs({ ...base, title: "श्रेया घोषाल ".repeat(12) }, NOW);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe("escapeIcsText and foldIcsLine", () => {
  it("escapes backslash, semicolon, comma and newlines", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("folds with CRLF + space and never splits a character", () => {
    const folded = foldIcsLine("SUMMARY:" + "🎧".repeat(40));
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "🎧".repeat(40));
  });

  it("leaves short lines alone", () => {
    expect(foldIcsLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});

describe("googleCalendarUrl", () => {
  it("builds a template link with UTC dates", () => {
    const url = new URL(googleCalendarUrl(base));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(base.title);
    expect(url.searchParams.get("dates")).toBe("20261219T133000Z/20261219T173000Z");
    expect(url.searchParams.get("location")).toBe("NSCI Dome, Mumbai");
    expect(url.searchParams.get("details")).toBe(`Playlist: ${base.url}#playlist`);
  });

  it("uses all-day dates for a date-only show", () => {
    const url = new URL(
      googleCalendarUrl({ ...base, dateOnly: true, startsAt: new Date("2026-12-18T18:30:00Z") }),
    );
    expect(url.searchParams.get("dates")).toBe("20261219/20261220");
  });
});

describe("icsFileName", () => {
  it.each([
    ["Sunburn Arena ft. Alan Walker", "sunburn-arena-ft-alan-walker.ics"],
    ["Café Nuit — Goa!", "cafe-nuit-goa.ics"],
    ["श्रेया घोषाल", "tixtape-show.ics"],
    ["", "tixtape-show.ics"],
  ])("%s → %s", (title, expected) => {
    expect(icsFileName(title)).toBe(expected);
  });
});

describe("calendarEventOf", () => {
  const event = {
    id: "e1",
    title: "Echoes of Earth 2026",
    type: "festival",
    startsAt: new Date("2026-12-04T18:30:00Z"),
    endsAt: new Date("2026-12-06T17:30:00Z"),
    venue: { name: "Embassy Riding School", city: "Bengaluru" },
  };

  it("reads a 00:00 IST start as date-only when the flag isn't given", () => {
    expect(calendarEventOf(event, "https://tixtape.vercel.app")).toEqual({
      id: "e1",
      title: "Echoes of Earth 2026",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      dateOnly: true,
      festival: true,
      location: "Embassy Riding School, Bengaluru",
      url: "https://tixtape.vercel.app/events/e1",
    });
  });

  it("trusts an explicit flag and a missing venue", () => {
    const c = calendarEventOf(
      { ...event, type: "concert", startsAtDateOnly: false, venue: null },
      "https://x",
    );
    expect(c).toMatchObject({ dateOnly: false, festival: false, location: null });
  });
});

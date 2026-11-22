import { describe, expect, it } from "vitest";
import {
  dayWindow,
  eventEnd,
  istDay,
  monthWindow,
  upcomingMonthWindow,
  weekendWindow,
  yearWindow,
} from "./ist-calendar";

const iso = (w: { from: Date; to: Date }) => [w.from.toISOString(), w.to.toISOString()];

describe("IST windows", () => {
  it("reads the IST calendar date, not the UTC one", () => {
    // 20:00 UTC on the 21st is 01:30 on the 22nd in India.
    expect(istDay(new Date("2026-11-21T20:00:00Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 22,
      weekday: 0,
    });
  });

  it.each([
    [
      "Wednesday → the coming Fri–Sun",
      "2026-11-25T06:00:00Z",
      0,
      "2026-11-26T18:30:00.000Z",
      "2026-11-29T18:29:59.999Z",
    ],
    [
      "Saturday → the rest of this weekend, from today (QA-F-5)",
      "2026-11-21T06:00:00Z",
      0,
      "2026-11-20T18:30:00.000Z",
      "2026-11-22T18:29:59.999Z",
    ],
    [
      "Sunday → the coming weekend; this one is all but over (QA-F-5)",
      "2026-11-22T06:00:00Z",
      0,
      "2026-11-26T18:30:00.000Z",
      "2026-11-29T18:29:59.999Z",
    ],
    [
      "Sunday after midnight IST is Monday → next Fri",
      "2026-11-22T19:00:00Z",
      0,
      "2026-11-26T18:30:00.000Z",
      "2026-11-29T18:29:59.999Z",
    ],
    [
      "Friday → today to Sunday",
      "2026-11-27T04:00:00Z",
      0,
      "2026-11-26T18:30:00.000Z",
      "2026-11-29T18:29:59.999Z",
    ],
    [
      "next weekend from Wednesday",
      "2026-11-25T06:00:00Z",
      1,
      "2026-12-03T18:30:00.000Z",
      "2026-12-06T18:29:59.999Z",
    ],
  ])("weekend: %s", (_label, now, ahead, from, to) => {
    expect(iso(weekendWindow(new Date(now), ahead))).toEqual([from, to]);
  });

  it.each([
    [0, "2026-11-20T18:30:00.000Z", "2026-11-21T18:29:59.999Z"],
    [1, "2026-11-21T18:30:00.000Z", "2026-11-22T18:29:59.999Z"],
  ])("day window +%i", (offset, from, to) => {
    expect(iso(dayWindow(new Date("2026-11-21T06:00:00Z"), offset))).toEqual([from, to]);
  });

  it("month and year windows", () => {
    expect(iso(monthWindow(2026, 11))).toEqual([
      "2026-11-30T18:30:00.000Z",
      "2026-12-31T18:29:59.999Z",
    ]);
    expect(iso(monthWindow(2026, 12))).toEqual([
      "2026-12-31T18:30:00.000Z",
      "2027-01-31T18:29:59.999Z",
    ]);
    expect(iso(yearWindow(2027))).toEqual(["2026-12-31T18:30:00.000Z", "2027-12-31T18:29:59.999Z"]);
  });

  it.each([
    ["december from November → this year", 11, 2026],
    ["november in November → this month", 10, 2026],
    ["march from November → next year", 2, 2027],
  ])("%s", (_label, month, year) => {
    expect(upcomingMonthWindow(new Date("2026-11-21T06:00:00Z"), month)).toEqual(
      monthWindow(year, month),
    );
  });
});

describe("eventEnd", () => {
  // 22 Nov 2026, stored at 00:00 IST = 21 Nov 18:30 UTC.
  const show = new Date("2026-11-21T18:30:00Z");
  it("a date-only show without an end runs to 23:59:59.999 IST on its day", () => {
    expect(eventEnd({ startsAt: show, endsAt: null, startsAtDateOnly: true }).toISOString()).toBe(
      "2026-11-22T18:29:59.999Z",
    );
  });
  it("a real end wins; a timed show without one ends at start plus the grace", () => {
    const endsAt = new Date("2026-11-22T10:00:00Z");
    expect(eventEnd({ startsAt: show, endsAt, startsAtDateOnly: true })).toEqual(endsAt);
    expect(eventEnd({ startsAt: show, endsAt: null })).toEqual(show);
    expect(eventEnd({ startsAt: show, endsAt: null }, 3_600_000).toISOString()).toBe(
      "2026-11-21T19:30:00.000Z",
    );
  });
});

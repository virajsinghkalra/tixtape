import { describe, expect, it } from "vitest";
import {
  countdownBadge,
  formatDateRange,
  formatStartTime,
  istDayCount,
  istParts,
  shortDate,
  yearTag,
} from "./event-format";

const d = (iso: string) => new Date(iso);

describe("istParts", () => {
  it("reads the calendar in IST, not UTC", () => {
    // 20:00 UTC on 31 Dec is 01:30 on 1 Jan in India.
    expect(istParts(d("2026-12-31T20:00:00Z"))).toMatchObject({
      day: "1",
      month: "Jan",
      year: "2027",
      hour: 1,
      minute: 30,
    });
  });
});

describe("formatDateRange", () => {
  it.each([
    ["one day, no end", "2027-02-06T19:00:00+05:30", null, "Sat, 6 Feb 2027"],
    [
      "ends the same day",
      "2027-02-06T19:00:00+05:30",
      "2027-02-06T23:00:00+05:30",
      "Sat, 6 Feb 2027",
    ],
    ["same month", "2027-01-23T12:00:00+05:30", "2027-01-24T23:00:00+05:30", "23–24 Jan 2027"],
    [
      "across months",
      "2027-01-31T12:00:00+05:30",
      "2027-02-01T23:00:00+05:30",
      "31 Jan – 1 Feb 2027",
    ],
    [
      "across years",
      "2026-12-31T12:00:00+05:30",
      "2027-01-01T23:00:00+05:30",
      "31 Dec 2026 – 1 Jan 2027",
    ],
  ])("%s", (_name, start, end, expected) => {
    expect(formatDateRange(d(start), end ? d(end) : null)).toBe(expected);
  });
});

describe("formatStartTime", () => {
  it.each([
    ["2027-02-06T19:00:00+05:30", "7:00 pm IST"],
    ["2027-02-06T12:30:00+05:30", "12:30 pm IST"],
    ["2027-02-06T09:05:00+05:30", "9:05 am IST"],
    ["2027-02-06T00:00:00+05:30", "Time TBA"],
  ])("%s → %s", (iso, expected) => {
    expect(formatStartTime(d(iso))).toBe(expected);
  });
});

describe("countdownBadge", () => {
  const now = d("2026-11-21T10:00:00+05:30");
  it.each([
    ["this evening", "2026-11-21T19:00:00+05:30", null, "🔴", "Tonight"],
    ["this afternoon", "2026-11-21T14:00:00+05:30", null, "🔴", "Today"],
    ["just after IST midnight", "2026-11-22T00:30:00+05:30", null, "⚡", "Tomorrow"],
    ["weeks away, counted in days", "2026-12-12T14:00:00+05:30", null, "⏰", "21 days to go"],
    ["months away", "2027-02-06T19:00:00+05:30", null, "📅", "In 3 months"],
    [
      "started, still on",
      "2026-11-20T12:00:00+05:30",
      "2026-11-22T23:00:00+05:30",
      "🔴",
      "Live now",
    ],
    ["over", "2026-11-19T12:00:00+05:30", "2026-11-19T23:00:00+05:30", "🎬", "Ended"],
  ])("%s", (_name, start, end, emoji, label) => {
    expect(countdownBadge(d(start), end ? d(end) : null, now)).toMatchObject({ emoji, label });
  });
});

describe("istDayCount", () => {
  it("counts IST calendar days", () => {
    expect(istDayCount(d("2026-12-29T14:00:00+05:30"), null)).toBe(1);
    expect(istDayCount(d("2026-12-29T14:00:00+05:30"), d("2026-12-30T23:00:00+05:30"))).toBe(2);
    expect(istDayCount(d("2026-12-29T20:00:00+05:30"), d("2026-12-30T02:00:00+05:30"))).toBe(2);
    expect(istDayCount(d("2026-12-29T20:00:00+05:30"), d("2026-12-29T23:00:00+05:30"))).toBe(1);
  });
});

describe("yearTag / shortDate", () => {
  const now = d("2026-11-22T12:00:00+05:30");
  it("always tags the IST year", () => {
    expect(shortDate(d("2026-12-20T20:00:00+05:30"), now)).toBe("20 Dec '26");
    expect(shortDate(d("2027-03-20T20:00:00+05:30"), now)).toBe("20 Mar '27");
    expect(yearTag(d("2026-12-31T20:00:00Z"), now)).toBe("'27"); // 1 Jan IST
  });
});

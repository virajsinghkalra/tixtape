import { describe, expect, it } from "vitest";
import { eventPerformanceMinutes, parseDailyHours, type ShowLengthInput } from "./show-length";

/** An IST wall-clock time as a Date. */
const ist = (s: string) => new Date(`${s}+05:30`);

const show = (over: Partial<ShowLengthInput>): ShowLengthInput => ({
  type: "festival",
  startsAt: ist("2026-12-29T14:00:00"),
  endsAt: null,
  isSingleArtist: false,
  ...over,
});

describe("parseDailyHours", () => {
  it.each([
    ["14:00-22:00 IST each day", 480],
    ["2pm – 10pm", 480],
    ["7 PM to 11:30 PM", 270],
    ["22:00-04:00", 360],
    ["doors at 5", null],
    ["14:00-14:10", null],
  ])("%s → %s", (text, minutes) => {
    expect(parseDailyHours(text)).toBe(minutes);
  });
});

describe("eventPerformanceMinutes", () => {
  it.each<[string, Partial<ShowLengthInput>, number, string]>([
    [
      "HOME Festival: 14:00–22:00 over 2 days = 960",
      { endsAt: ist("2026-12-30T22:00:00") },
      960,
      "times",
    ],
    [
      "verified hours beat times",
      { endsAt: ist("2026-12-30T23:00:00"), hours: "14:00-22:00 IST each day" },
      960,
      "hours",
    ],
    ["festival without an end: 8 h", {}, 480, "default"],
    [
      "festival over 3 days with unusable times: 3 × 8 h",
      { startsAt: ist("2026-12-27T00:00:00"), endsAt: ist("2026-12-29T00:00:00") },
      1440,
      "default",
    ],
    ["single-artist concert: 150 min", { type: "concert", isSingleArtist: true }, 150, "default"],
    ["multi-artist concert: 240 min", { type: "concert" }, 240, "default"],
    [
      "concert with start and end",
      { type: "concert", startsAt: ist("2026-12-05T19:30:00"), endsAt: ist("2026-12-05T22:30:00") },
      180,
      "times",
    ],
    [
      "a show past midnight is one day",
      { type: "concert", startsAt: ist("2026-12-05T21:00:00"), endsAt: ist("2026-12-06T02:00:00") },
      300,
      "times",
    ],
  ])("%s", (_n, over, minutes, source) => {
    expect(eventPerformanceMinutes(show(over))).toMatchObject({ minutes, source });
  });
});

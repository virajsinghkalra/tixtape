import { describe, expect, it } from "vitest";
import { countdownLabel, shortTitle } from "./hero-copy";

describe("shortTitle", () => {
  it.each([
    [
      "Shreya Ghoshal – The Unstoppable India Tour – Bengaluru",
      "Shreya Ghoshal",
      "Shreya Ghoshal · Bengaluru",
    ],
    ["Martin Garrix India Tour 2027 – Mumbai", "Martin Garrix", "Martin Garrix · Mumbai"],
    ["Anyma Presents Aeden – Mumbai", "Anyma", "Anyma Presents Aeden · Mumbai"],
    ["HOME Festival 2026", "Arijit Singh", "HOME Festival 2026"],
    [
      "Sunburn Arena ft. The Chainsmokers – Bengaluru",
      "The Chainsmokers",
      "The Chainsmokers · Bengaluru",
    ],
    [
      "A Very Long Festival Name Without Any Dashes 2026",
      undefined,
      "A Very Long Festival Name Witho…",
    ],
  ])("%s", (title, headliner, expected) => {
    expect(shortTitle(title, headliner)).toBe(expected);
    expect(shortTitle(title, headliner).length).toBeLessThanOrEqual(32);
  });
});

describe("countdownLabel", () => {
  // 22 Nov 2026 10:00 IST = 04:30 UTC.
  const now = new Date("2026-11-22T04:30:00Z");
  it.each([
    ["date-only tonight", "2026-11-21T18:30:00Z", true, "Tonight 🔥"],
    ["8 pm tonight", "2026-11-22T14:30:00Z", false, "Tonight 🔥"],
    ["1:20 pm today", "2026-11-22T07:50:00Z", false, "in 3h 20m"],
    ["tomorrow", "2026-11-23T14:30:00Z", false, "Tomorrow ⚡"],
    ["in 2d 4h", "2026-11-24T08:30:00Z", false, "in 2d 4h"],
    ["date-only in 3 days", "2026-11-24T18:30:00Z", true, "in 3d"],
    ["far", "2026-12-20T14:30:00Z", false, "in 28d"],
  ])("%s", (_, startsAt, dateOnly, label) => {
    expect(countdownLabel(new Date(startsAt), null, now, dateOnly)).toBe(label);
  });
  it("is live while it runs", () => {
    expect(
      countdownLabel(new Date("2026-11-22T04:00:00Z"), new Date("2026-11-22T08:00:00Z"), now),
    ).toBe("Live now 🔴");
  });
});

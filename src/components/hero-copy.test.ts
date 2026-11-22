import { describe, expect, it } from "vitest";
import { countdownLabel, pickNextUp, shortTitle, slideAt } from "./hero-copy";

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

describe("pickNextUp (UX #6)", () => {
  const NOW = new Date("2026-11-23T12:00:00Z");
  const ev = (
    id: string,
    playlistStatus: "ready" | "building" | null,
    startsAt = new Date("2026-12-01T14:00:00Z"),
    endsAt: Date | null = null,
  ) => ({ id, playlistStatus, startsAt, endsAt });
  it("ready playlists first, then cooking, then soonest", () => {
    const rows = [
      ev("a", null),
      ev("b", "building"),
      ev("c", "ready"),
      ev("d", null),
      ev("e", "ready"),
    ];
    expect(pickNextUp(rows, NOW).map((r) => r.id)).toEqual(["c", "e", "b"]);
  });
  it("skips shows that already ended", () => {
    const rows = [
      ev("gone", "ready", new Date("2026-11-23T05:00:00Z"), new Date("2026-11-23T08:00:00Z")),
      ev("live", null, new Date("2026-11-23T10:00:00Z"), new Date("2026-11-23T16:00:00Z")),
      ev("soon", null),
    ];
    expect(pickNextUp(rows, NOW).map((r) => r.id)).toEqual(["live", "soon"]);
  });
  it("only looks at the soonest shows", () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => ev(`n${i}`, null)), ev("late", "ready")];
    expect(pickNextUp(rows, NOW).map((r) => r.id)).toEqual(["n0", "n1", "n2"]);
  });
});

describe("slideAt: one slide object per index (no picture/title desync)", () => {
  const items = [
    { id: "shreya", title: "Shreya Ghoshal · Bengaluru", poster: "s.jpg" },
    { id: "anyma", title: "Anyma Presents Aeden · Mumbai", poster: "a.jpg" },
    { id: "bhuwin", title: "Bhuwin · Mumbai", poster: "b.jpg" },
  ];
  it("the picture and the title always come from the same show", () => {
    for (let i = -4; i < 10; i++) {
      const s = slideAt(items, i)!;
      expect(s.slide).toBe(items[s.index]);
      expect(s.slide.poster[0]).toBe(s.slide.id[0]);
    }
  });
  it("wraps forwards and backwards, and survives the list shrinking", () => {
    expect(slideAt(items, 3)?.slide.id).toBe("shreya");
    expect(slideAt(items, -1)?.slide.id).toBe("bhuwin");
    expect(slideAt(items.slice(0, 1), 2)?.slide.id).toBe("shreya");
    expect(slideAt([], 0)).toBeNull();
  });
});

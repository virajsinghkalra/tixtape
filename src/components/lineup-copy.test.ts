import { describe, expect, it } from "vitest";
import {
  introLine,
  joinNames,
  PLAYLIST_SOON,
  STORY_CTA,
  STORY_HEADER,
  STORY_KICKERS,
  lineupTeaser,
  lineupShape,
  plural,
  shareText,
  tierLabel,
  titleSize,
  whoLine,
} from "./lineup-copy";

describe("plural", () => {
  it.each([
    [0, "artist", "0 artists"],
    [1, "artist", "1 artist"],
    [2, "artist", "2 artists"],
  ])("%i %s → %s", (n, word, expected) => {
    expect(plural(n, word)).toBe(expected);
  });
  it("takes an irregular plural", () => {
    expect(plural(2, "city", "cities")).toBe("2 cities");
  });
});

describe("lineupShape and whoLine", () => {
  it.each([
    [[], 0, "empty", "Lineup soon 🫣"],
    [["Bhuwin"], 1, "solo", "Bhuwin, all night."],
    [["Anyma", "Aeden"], 2, "duo", "Anyma and Aeden. One night."],
    [["A", "B", "C"], 3, "trio", "A, B and C. One night."],
    [["A", "B", "C", "D"], 34, "festival", "34 artists."],
  ] as const)("%j", (names, total, shape, line) => {
    expect(lineupShape(total)).toBe(shape);
    expect(whoLine(names, total)).toBe(line);
  });

  it("joins names naturally", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("tierLabel", () => {
  it("is singular for one artist", () => {
    expect(tierLabel("headliner", 1)).toBe("Headliner");
    expect(tierLabel("headliner", 2)).toBe("Headliners");
    expect(tierLabel("sub", 1)).toBe("Sub-headliner");
    expect(tierLabel("support", 5)).toBe("Support");
  });
});

describe("shareText", () => {
  it("is tiny: the artist for a solo show, else the title", () => {
    expect(shareText("Anyma Presents Aeden – Mumbai", ["Anyma"])).toBe("Anyma, live 🎧");
    expect(shareText("HOME Festival 2026", ["A", "B"])).toBe("HOME Festival 2026 🎧");
  });
});

describe("titleSize", () => {
  it("shrinks long titles", () => {
    expect(titleSize("HOME Festival")).toBe("xl");
    expect(titleSize("Lollapalooza India 2027")).toBe("lg");
    expect(titleSize("Martin Garrix India Tour 2027 – Bhubaneswar")).toBe("md");
  });
});

describe("lineupTeaser (cards)", () => {
  it.each([
    [["Martin Garrix"], 1, "Martin Garrix, all night"],
    [["Anyma", "Aeden"], 2, "Anyma and Aeden"],
    [["A", "B"], 34, "A, B + 32 more"],
    [[], 1, "1 artist"],
    [[], 0, "0 artists"],
  ] as const)("%j of %i", (names, count, expected) => {
    expect(lineupTeaser(names, count)).toBe(expected);
  });
});

describe("story copy", () => {
  it("never counts slides", () => {
    expect(STORY_HEADER).toBe("The rundown");
    expect(STORY_HEADER).not.toMatch(/slide/i);
  });

  it.each([
    [["A", "B"], 34, 2, "34 acts. 2 days."],
    [["A", "B"], 12, 1, "12 acts. One night."],
    [["Anyma", "Aeden"], 2, 1, "Anyma and Aeden. One night."],
    [["A", "B", "C"], 3, 2, "A, B and C. 2 days."],
    [["Bhuwin"], 1, 1, "Bhuwin, all night."],
    [[], 0, 1, "Lineup soon 🫣"],
  ] as const)("%j, %i acts, %i days", (names, total, days, line) => {
    expect(introLine(names, total, days)).toBe(line);
  });

  it("kickers and overflow lines", () => {
    expect(STORY_KICKERS.gems(1)).toBe("💎 Catch this one early");
    expect(STORY_KICKERS.gems(5)).toBe("💎 Catch these early");
  });
});

describe("minimal copy (D-082)", () => {
  const all = [PLAYLIST_SOON, ...Object.values(STORY_CTA), STORY_HEADER];
  it("is 2–4 words, with no counts of songs or minutes and no login talk", () => {
    for (const line of all) {
      expect(line.split(/\s+/).filter((w) => /\w/.test(w)).length).toBeLessThanOrEqual(4);
      expect(line).not.toMatch(/\bsongs?\b|\bmin\b|login/i);
    }
    expect(PLAYLIST_SOON).toBe("Playlist soon ⏳");
  });
});

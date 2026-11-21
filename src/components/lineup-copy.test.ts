import { describe, expect, it } from "vitest";
import {
  introLine,
  joinNames,
  moreLine,
  pendingLine,
  STORY_HEADER,
  STORY_KICKERS,
  lineupTeaser,
  lineupShape,
  orderLine,
  plural,
  shareText,
  spotifyMatchLine,
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
    [[], 0, "empty", "Lineup coming soon."],
    [["Bhuwin"], 1, "solo", "Bhuwin, all night."],
    [["Anyma", "Aeden"], 2, "duo", "Anyma and Aeden. One night."],
    [["A", "B", "C"], 3, "trio", "A, B and C. One night."],
    [["A", "B", "C", "D"], 34, "festival", "34 artists. Here's who to know."],
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

describe("orderLine", () => {
  it("says nothing about order for a solo show", () => {
    expect(orderLine(1, 1)).toBeNull();
    expect(orderLine(2, 1)).toBe("In billing order.");
    expect(orderLine(8, 4)).toBe("Headliners first, openers last.");
  });
});

describe("spotifyMatchLine", () => {
  it.each([
    [1, 1, "Bhuwin", "Bhuwin is on Spotify."],
    [0, 1, "Bhuwin", "Bhuwin isn't matched on Spotify yet."],
    [0, 3, undefined, "None of the 3 artists are matched on Spotify yet."],
    [5, 8, undefined, "5 of 8 artists matched on Spotify so far."],
  ])("%i of %i", (matched, total, name, line) => {
    expect(spotifyMatchLine(matched, total, name)).toBe(line);
  });
});

describe("shareText", () => {
  it("leads with the artist for a solo show", () => {
    expect(shareText("Anyma Presents Aeden – Mumbai", ["Anyma"])).toBe(
      "Anyma live: Anyma Presents Aeden – Mumbai. One playlist to get ready.",
    );
    expect(shareText("HOME Festival 2026", ["A", "B"])).toBe(
      "HOME Festival 2026: the lineup and one playlist",
    );
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
    [["A", "B"], 34, 2, "34 acts. 2 days. Here's your cheat sheet."],
    [["A", "B"], 12, 1, "12 acts. One night. Here's your cheat sheet."],
    [["Anyma", "Aeden"], 2, 1, "Anyma and Aeden. One night."],
    [["A", "B", "C"], 3, 2, "A, B and C. 2 days."],
    [["Bhuwin"], 1, 1, "Bhuwin, all night."],
    [[], 0, 1, "Lineup drops soon. Watch this space."],
  ] as const)("%j, %i acts, %i days", (names, total, days, line) => {
    expect(introLine(names, total, days)).toBe(line);
  });

  it("kickers and overflow lines", () => {
    expect(STORY_KICKERS.gems(1)).toBe("💎 Catch this one early");
    expect(STORY_KICKERS.gems(5)).toBe("💎 Catch these early");
    expect(moreLine(20)).toBe("+ 20 more on the lineup");
    expect(moreLine(0)).toBeNull();
  });
});

describe("pendingLine", () => {
  it("names a solo artist, never counts songs", () => {
    expect(pendingLine(["Shreya Ghoshal"])).toBe(
      "Playlist coming soon: we're matching Shreya Ghoshal on Spotify.",
    );
  });
  it("joins a small lineup and counts a festival", () => {
    expect(pendingLine(["A", "B"])).toBe(
      "Playlist coming soon: we're matching A and B on Spotify.",
    );
    expect(pendingLine(["A", "B", "C", "D"], 34)).toBe(
      "Playlist coming soon: we're matching all 34 artists on Spotify.",
    );
  });
});

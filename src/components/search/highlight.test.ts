import { describe, expect, it } from "vitest";
import { highlightMatch } from "./highlight";

describe("highlightMatch", () => {
  it("marks a case-insensitive match and keeps the original casing", () => {
    expect(highlightMatch("Lollapalooza India", "LOLLA")).toEqual([
      { text: "Lolla", match: true },
      { text: "palooza India", match: false },
    ]);
  });

  it("marks every occurrence", () => {
    expect(highlightMatch("Lo-lo land", "lo")).toEqual([
      { text: "Lo", match: true },
      { text: "-", match: false },
      { text: "lo", match: true },
      { text: " land", match: false },
    ]);
  });

  it("marks a match in the middle and at the end", () => {
    expect(highlightMatch("NH7 Weekender", "end")).toEqual([
      { text: "NH7 Week", match: false },
      { text: "end", match: true },
      { text: "er", match: false },
    ]);
  });

  it.each([
    ["empty query", ""],
    ["blank query", "   "],
    ["no match", "xyz"],
  ])("returns the whole text unmarked for %s", (_name, query) => {
    expect(highlightMatch("Diljit Live", query)).toEqual([{ text: "Diljit Live", match: false }]);
  });
});

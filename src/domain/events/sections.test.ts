import { describe, expect, it } from "vitest";
import { buildSections, SECTION_SIZE } from "./sections";

const ev = (id: string) => ({ id });
const ids = (n: number, prefix = "e") => Array.from({ length: n }, (_, i) => ev(`${prefix}${i}`));

describe("buildSections", () => {
  it("caps each section at 5 and never repeats an event across sections", () => {
    const sections = buildSections({
      trending: ids(7),
      thisWeekend: [ev("e0"), ev("e1"), ev("w1"), ev("e6")],
      nearYou: { city: "Pune", items: [ev("w1"), ev("p1")] },
      popularSearches: ["lolla", "nh7", "lolla"],
    });
    expect(
      sections.map((s) => [s.id, "items" in s ? s.items.map((i) => i.id) : s.queries]),
    ).toEqual([
      ["trending", ["e0", "e1", "e2", "e3", "e4"]],
      ["this_weekend", ["w1", "e6"]],
      ["near_you", ["p1"]],
      ["popular_searches", ["lolla", "nh7"]],
    ]);
    expect(sections[0]!.title).toBe("Trending now");
    expect(sections[2]!.title).toBe("Near you · Pune");
    for (const s of sections)
      if ("items" in s) expect(s.items.length).toBeLessThanOrEqual(SECTION_SIZE);
  });

  it.each([
    [
      "no city → no near_you",
      { trending: ids(2), thisWeekend: [], popularSearches: [] },
      ["trending"],
    ],
    ["empty lists are dropped", { trending: [], thisWeekend: [], popularSearches: [] }, []],
    [
      "for_you after near_you when present",
      { trending: ids(1), thisWeekend: [], forYou: ids(2, "f"), popularSearches: ["x"] },
      ["trending", "for_you", "popular_searches"],
    ],
    [
      "up_next fills in without engagement data",
      { trending: [], thisWeekend: [ev("w")], upNext: [ev("w"), ev("u")], popularSearches: [] },
      ["this_weekend", "up_next"],
    ],
  ])("%s", (_label, input, expected) => {
    expect(buildSections(input).map((s) => s.id)).toEqual(expected);
  });
});

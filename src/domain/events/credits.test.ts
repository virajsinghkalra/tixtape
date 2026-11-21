import { describe, expect, it } from "vitest";
import { isKnownCompoundAct, KNOWN_COMPOUND_ACTS, splitLineupCredit } from "./credits";

describe("splitLineupCredit (D-091)", () => {
  it.each<[string, string[]]>([
    // Known acts are never split, whatever the joining word or case.
    ["TOMORROW X TOGETHER", ["TOMORROW X TOGETHER"]],
    ["Tomorrow x Together", ["Tomorrow x Together"]],
    ["Simon & Garfunkel", ["Simon & Garfunkel"]],
    ["Simon and Garfunkel", ["Simon and Garfunkel"]],
    ["Salim & Sulaiman", ["Salim & Sulaiman"]],
    ["Earth, Wind & Fire", ["Earth, Wind & Fire"]],
    ["Florence + The Machine", ["Florence + The Machine"]],
    ["Jon Batiste with Stay Human", ["Jon Batiste with Stay Human"]],
    // A known act inside a longer credit stays whole; the rest still splits.
    ["Tomorrow X Together x Halsey", ["Tomorrow X Together", "Halsey"]],
    ["Halsey ft. TOMORROW X TOGETHER", ["Halsey", "TOMORROW X TOGETHER"]],
    // Real collaborations still split.
    ["Nucleya b2b Ritviz", ["Nucleya", "Ritviz"]],
    ["Lil Nas X x Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Badshah ft. Aastha Gill", ["Badshah", "Aastha Gill"]],
    ["Martin Garrix vs Tiësto", ["Martin Garrix", "Tiësto"]],
    ["Diljit Dosanjh (feat. Sia)", ["Diljit Dosanjh", "Sia"]],
    // A duo credited together stays one row: Matching reviews it (D-066).
    ["Khan & Noor", ["Khan & Noor"]],
    ["  ", []],
  ])("%j → %j", (raw, expected) => {
    expect(splitLineupCredit(raw)).toEqual(expected);
  });

  it("an existing artist or alias counts as a known act", () => {
    const known = (name: string) => name.toLowerCase() === "stray x kids";
    expect(splitLineupCredit("Stray X Kids", { isKnownAct: known })).toEqual(["Stray X Kids"]);
    expect(splitLineupCredit("Stray X Kids")).toEqual(["Stray", "Kids"]);
    expect(splitLineupCredit("Stray X Kids b2b Zedd", { isKnownAct: known })).toEqual([
      "Stray X Kids",
      "Zedd",
    ]);
  });

  it("verified lineups keep every credit exactly as given", () => {
    expect(splitLineupCredit("Nucleya b2b Ritviz", { split: false })).toEqual([
      "Nucleya b2b Ritviz",
    ]);
    expect(splitLineupCredit(" TOMORROW X TOGETHER ", { split: false })).toEqual([
      "TOMORROW X TOGETHER",
    ]);
  });

  it("every allow-listed act is recognised under its own spelling", () => {
    for (const act of KNOWN_COMPOUND_ACTS) {
      expect(isKnownCompoundAct(act)).toBe(true);
      expect(splitLineupCredit(act)).toEqual([act]);
    }
    expect(isKnownCompoundAct("simon AND garfunkel")).toBe(true);
    expect(isKnownCompoundAct("Simon")).toBe(false);
  });
});

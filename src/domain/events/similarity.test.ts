import { describe, expect, it } from "vitest";
import { diceOverlap, jaccard, jaroWinkler } from "./similarity";

describe("jaroWinkler", () => {
  it.each([
    ["martha", "marhta", 0.961],
    ["dixon", "dicksonx", 0.813],
    ["dwayne", "duane", 0.84],
    ["mahalaxmi", "mahalakshmi", 0.927],
  ])("%s vs %s ≈ %f", (a, b, expected) => {
    expect(jaroWinkler(a, b)).toBeCloseTo(expected, 2);
  });

  it.each([
    ["", "", 1],
    ["abc", "", 0],
    ["", "abc", 0],
    ["nsci dome", "nsci dome", 1],
    ["abc", "xyz", 0],
  ])("edge case %j vs %j = %f", (a, b, expected) => {
    expect(jaroWinkler(a, b)).toBe(expected);
  });

  it("is symmetric", () => {
    expect(jaroWinkler("bhartiya city", "bharatiya city")).toBe(
      jaroWinkler("bharatiya city", "bhartiya city"),
    );
  });
});

describe("set overlap", () => {
  it.each([
    [["a", "b"], ["a", "b"], 1, 1],
    [["a", "b"], ["b", "c"], 1 / 3, 0.5],
    [["a"], ["b"], 0, 0],
    [[], [], 0, 0],
    [["a", "a", "b"], ["a", "b"], 1, 1],
  ])("%j vs %j → jaccard %f, dice %f", (a, b, j, d) => {
    expect(jaccard(a, b)).toBeCloseTo(j);
    expect(diceOverlap(a, b)).toBeCloseTo(d);
  });
});

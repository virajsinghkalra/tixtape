import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import { groupByTier, isMatched, splitTail } from "./lineup-view";

const artist = (name: string, tier: BillingTier, billingRank: number) => ({
  name,
  tier,
  billingRank,
});

describe("groupByTier", () => {
  it("orders tiers headliner → support and artists by billing rank, skipping empty tiers", () => {
    const groups = groupByTier([
      artist("Ritviz", "support", 8),
      artist("Limp Bizkit", "headliner", 2),
      artist("Prateek Kuhad", "mid", 5),
      artist("Olivia Dean", "headliner", 1),
    ]);
    expect(groups.map((g) => [g.tier, g.artists.map((a) => a.name)])).toEqual([
      ["headliner", ["Olivia Dean", "Limp Bizkit"]],
      ["mid", ["Prateek Kuhad"]],
      ["support", ["Ritviz"]],
    ]);
  });

  it("returns nothing for an empty lineup", () => {
    expect(groupByTier([])).toEqual([]);
  });
});

describe("isMatched", () => {
  it.each([
    ["auto", true],
    ["manual", true],
    ["pending", false],
    ["needs_review", false],
    ["not_found", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(isMatched(status)).toBe(expected);
  });
});

describe("splitTail", () => {
  const many = (n: number, tier: BillingTier) =>
    Array.from({ length: n }, (_, i) => artist(`${tier}${i}`, tier, i));
  const groups = (h: number, sub: number, mid: number, sup: number) =>
    groupByTier([
      ...many(h, "headliner"),
      ...many(sub, "sub"),
      ...many(mid, "mid"),
      ...many(sup, "support"),
    ]);

  it("never splits a small lineup", () => {
    const g = groups(2, 4, 8, 10);
    expect(splitTail(g)).toEqual({ shown: g, tail: [] });
  });

  it("keeps whole top tiers within the cap and folds the rest", () => {
    const { shown, tail } = splitTail(groups(4, 7, 9, 46));
    expect(shown.map((x) => x.tier)).toEqual(["headliner", "sub", "mid"]);
    expect(tail.map((x) => x.tier)).toEqual(["support"]);
  });

  it("folds a tier that would overshoot the cap", () => {
    const { shown, tail } = splitTail(groups(4, 7, 15, 30));
    expect(shown.map((x) => x.tier)).toEqual(["headliner", "sub"]);
    expect(tail.map((x) => x.tier)).toEqual(["mid", "support"]);
  });

  it("always shows the first tier, even when it alone exceeds the cap", () => {
    const { shown, tail } = splitTail(groups(30, 0, 0, 5));
    expect(shown.map((x) => x.tier)).toEqual(["headliner"]);
    expect(tail.map((x) => x.tier)).toEqual(["support"]);
  });
});

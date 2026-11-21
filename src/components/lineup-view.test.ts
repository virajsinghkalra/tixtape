import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import { groupByTier, isMatched } from "./lineup-view";

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

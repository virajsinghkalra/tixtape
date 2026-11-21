import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import { buildLineup, lineupHash, tierFromAttractionOrder } from "./lineup";
import type { RawLineupEntry } from "./raw-event";

const entry = (name: string, billingRank: number, tier: BillingTier = "mid"): RawLineupEntry => ({
  name,
  billingRank,
  tier,
});

describe("buildLineup", () => {
  it("splits b2b credits into consecutive entries with the credit's tier", () => {
    const lineup = buildLineup([
      entry("Prateek Kuhad", 1, "headliner"),
      entry("Nucleya b2b Ritviz", 2, "sub"),
      entry("The Local Train", 3),
    ]);
    expect(lineup.map((e) => [e.name, e.normalizedName, e.tier, e.billingRank])).toEqual([
      ["Prateek Kuhad", "prateek kuhad", "headliner", 1],
      ["Nucleya", "nucleya", "sub", 2],
      ["Ritviz", "ritviz", "sub", 3],
      ["The Local Train", "local train", "mid", 4],
    ]);
  });

  it("orders by billing rank, keeps input order on ties, and renumbers without gaps", () => {
    const lineup = buildLineup([entry("C", 10), entry("A", 2), entry("B", 2)]);
    expect(lineup.map((e) => [e.name, e.billingRank])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
  });

  it("keeps an artist's highest billing when listed twice", () => {
    const lineup = buildLineup([
      { ...entry("Divine", 1, "headliner"), day: 1 },
      { ...entry("DIVINE (Live)", 5, "mid"), day: 2 },
    ]);
    expect(lineup).toEqual([
      {
        name: "Divine",
        normalizedName: "divine",
        tier: "headliner",
        billingRank: 1,
        day: 1,
        stage: null,
      },
    ]);
  });

  it("drops credits that normalize to nothing", () => {
    expect(buildLineup([entry("!!!", 1), entry("Anuv Jain", 2)]).map((e) => e.name)).toEqual([
      "Anuv Jain",
    ]);
  });
});

describe("lineupHash", () => {
  const base = [
    { name: "A.R. Rahman", tier: "headliner" as const },
    { name: "Shilpa Rao", tier: "support" as const },
  ];

  it.each([
    [
      "same names, different spelling",
      [
        { tier: "headliner" as const, name: "AR Rahman" },
        { name: "shilpa rao", tier: "support" as const },
      ],
      true,
    ],
    [
      "object key order",
      [
        { tier: "headliner" as const, name: "A.R. Rahman" },
        { tier: "support" as const, name: "Shilpa Rao" },
      ],
      true,
    ],
    ["reordered", [...base].reverse(), false],
    ["re-tiered", [base[0]!, { name: "Shilpa Rao", tier: "mid" as const }], false],
    ["artist added", [...base, { name: "Jonita Gandhi", tier: "support" as const }], false],
    ["artist removed", [base[0]!], false],
  ])("%s → equal: %s", (_label, other, equal) => {
    expect(lineupHash(other) === lineupHash(base)).toBe(equal);
  });

  it("is a hex sha-256", () => {
    expect(lineupHash([])).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("tierFromAttractionOrder", () => {
  it.each([
    [0, 1, "headliner"],
    [0, 3, "headliner"],
    [1, 2, "support"],
    [2, 3, "support"],
    [1, 4, "sub"],
    [2, 20, "sub"],
    [3, 20, "mid"],
    [9, 20, "mid"],
    [10, 20, "support"],
  ])("position %i of %i → %s", (index, total, tier) => {
    expect(tierFromAttractionOrder(index, total)).toBe(tier);
  });
});

import { describe, expect, it } from "vitest";
import {
  demandCity,
  listingsForRun,
  metroDemand,
  pickByDemand,
  planRun,
  type DemandCount,
  type RunPlan,
} from "./demand";
import { buildWatchlist, pickForRun, type WatchSignal } from "./watchlist";

const now = new Date("2026-11-22T10:00:00+05:30");
const row = (day: string, city: string, kind: DemandCount["kind"], count: number): DemandCount => ({
  day,
  city,
  kind,
  count,
});

describe("metroDemand", () => {
  it("folds cities into metro clusters and weights searches above views", () => {
    const d = metroDemand(
      [
        row("2026-11-22", "Mumbai", "view", 10),
        row("2026-11-22", "Thane", "view", 5),
        row("2026-11-22", "Pune", "search", 2),
        row("2026-11-22", "Bengaluru", "view", 12),
      ],
      now,
    );
    expect(d.map((m) => [m.metro, m.score])).toEqual([
      ["mumbai", 21], // 10 + 5 + 2 × 3
      ["bengaluru", 12],
    ]);
    expect(d[0]!.cities).toEqual(["Mumbai", "Thane", "Pune"]);
  });

  it("decays with a 7-day half-life and ignores counts older than 14 days", () => {
    const d = metroDemand(
      [
        row("2026-11-15", "Chennai", "view", 8), // 7 days old → 4
        row("2026-11-01", "Kolkata", "view", 1000), // outside the window
      ],
      now,
    );
    expect(d).toEqual([{ metro: "chennai", cities: ["Chennai"], score: 4 }]);
  });

  it("ignores non-positive and malformed rows", () => {
    expect(
      metroDemand([row("not-a-day", "Goa", "view", 3), row("2026-11-22", "Goa", "view", 0)], now),
    ).toEqual([]);
  });
});

describe("planRun", () => {
  const demand = metroDemand(
    [
      row("2026-11-22", "Mumbai", "view", 60),
      row("2026-11-22", "Bengaluru", "view", 30),
      row("2026-11-22", "Guwahati", "view", 10),
      row("2026-11-22", "Jaipur", "view", 5),
    ],
    now,
  );
  const shows = [
    { city: "Mumbai", count: 12 },
    { city: "Navi Mumbai", count: 3 },
    { city: "Bengaluru", count: 8 },
    { city: "Guwahati", count: 1 },
  ];

  it("gives the top metros a demand-proportional share and keeps a 30% floor", () => {
    const plan = planRun(demand, shows, 10);
    expect(plan.floorSlots).toBe(3);
    expect(plan.metros.reduce((s, m) => s + m.slots, 0)).toBe(7);
    expect(Object.fromEntries(plan.metros.map((m) => [m.metro, m.slots]))).toEqual({
      guwahati: 1,
      mumbai: 4,
      bengaluru: 2,
    });
    expect(plan.metros.map((m) => m.metro)).not.toContain("jaipur"); // only the top 3
  });

  it("serves a top metro with fewer than 5 upcoming shows first", () => {
    const plan = planRun(demand, shows, 10);
    expect(plan.metros[0]).toMatchObject({ metro: "guwahati", upcoming: 1, scarce: true });
    expect(plan.metros.find((m) => m.metro === "mumbai")).toMatchObject({
      upcoming: 15,
      scarce: false,
    });
  });

  it("orders several scarce metros by fewest shows, then demand", () => {
    const plan = planRun(demand, [], 10);
    expect(plan.metros.map((m) => m.metro)).toEqual(["mumbai", "bengaluru", "guwahati"]);
    const some = planRun(demand, [{ city: "Mumbai", count: 4 }], 10);
    expect(some.metros.map((m) => m.metro)).toEqual(["bengaluru", "guwahati", "mumbai"]);
  });

  it("gives every top metro at least one slot while slots last", () => {
    const tiny = planRun(demand, shows, 3, { floorShare: 0 });
    expect(tiny.metros.every((m) => m.slots >= 1)).toBe(true);
  });

  it("is all floor without demand, and respects the floor share bounds", () => {
    expect(planRun([], shows, 10)).toEqual({ metros: [], floorSlots: 10 });
    expect(planRun(demand, shows, 10, { floorShare: 1 }).floorSlots).toBe(10);
    expect(planRun(demand, shows, 10, { floorShare: -2 }).floorSlots).toBe(0);
  });
});

describe("pickByDemand", () => {
  const signals: WatchSignal[] = [
    { name: "Searched Star", origin: "searched", weight: 9 },
    ...[
      "Mumbai One",
      "Mumbai Two",
      "Mumbai Three",
      "Blr One",
      "Ghy One",
      "Other A",
      "Other B",
      "Other C",
      "Other D",
    ].map((name, i) => ({ name, origin: "trending" as const, weight: 100 - i })),
  ];
  const list = buildWatchlist(signals, 50);
  const artistCities = [
    { name: "Mumbai One", city: "Mumbai" },
    { name: "Mumbai Two", city: "Pune" }, // same metro
    { name: "Mumbai Three", city: "Mumbai" },
    { name: "Blr One", city: "Bengaluru" },
    { name: "Ghy One", city: "Guwahati" },
  ];
  const plan: RunPlan = {
    metros: [
      { metro: "guwahati", cities: ["Guwahati"], score: 10, upcoming: 1, scarce: true, slots: 1 },
      {
        metro: "mumbai",
        cities: ["Mumbai", "Pune"],
        score: 60,
        upcoming: 15,
        scarce: false,
        slots: 2,
      },
      {
        metro: "bengaluru",
        cities: ["Bengaluru"],
        score: 30,
        upcoming: 8,
        scarce: false,
        slots: 2,
      },
    ],
    floorSlots: 2,
  };

  it("runs the scarce metro first, then searched artists, then other metros, then the floor", () => {
    const picked = pickByDemand(list, artistCities, plan, 10, 0);
    expect(picked.map((a) => [a.name, a.reason])).toEqual([
      ["Ghy One", "guwahati"],
      ["Searched Star", "searched"],
      ["Mumbai One", "mumbai"],
      ["Mumbai Two", "mumbai"],
      ["Blr One", "bengaluru"],
      ["Mumbai Three", "floor"],
      ["Other A", "floor"],
      ["Other B", "floor"],
    ]);
    expect(picked.find((a) => a.name === "Mumbai One")?.focusCities).toEqual(["Mumbai", "Pune"]);
    expect(picked.find((a) => a.reason === "floor")?.focusCities).toEqual([]);
  });

  it("hands a metro's unfilled slots to the floor (Bengaluru has one artist for two slots)", () => {
    const picked = pickByDemand(list, artistCities, plan, 10, 0);
    expect(picked.filter((a) => a.reason === "floor")).toHaveLength(3);
  });

  it("never exceeds the run size", () => {
    expect(pickByDemand(list, artistCities, plan, 3, 0)).toHaveLength(3);
  });

  it("without demand data is exactly the old rotation", () => {
    const empty = { metros: [], floorSlots: 5 };
    expect(pickByDemand(list, artistCities, empty, 5, 3).map((a) => a.name)).toEqual(
      pickForRun(list, 5, 3).map((a) => a.name),
    );
  });

  it("the floor still reaches artists outside every demand metro over a few runs", () => {
    const seen = new Set<string>();
    for (let day = 0; day < 4; day++) {
      for (const a of pickByDemand(list, artistCities, plan, 8, day)) seen.add(a.name);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["Other A", "Other B", "Other C", "Other D"]));
  });
});

describe("listingsForRun", () => {
  const slugs = ["bangalore", "delhi-ncr", "mumbai", "hyderabad", "goa"];
  const cityOf = (s: string) =>
    ({
      bangalore: "Bengaluru",
      "delhi-ncr": "Delhi",
      mumbai: "Mumbai",
      hyderabad: "Hyderabad",
      goa: "Goa",
    })[s]!;
  const plan: RunPlan = {
    metros: [
      { metro: "goa", cities: ["Goa"], score: 5, upcoming: 0, scarce: true, slots: 1 },
      { metro: "mumbai", cities: ["Mumbai"], score: 50, upcoming: 20, scarce: false, slots: 3 },
    ],
    floorSlots: 2,
  };

  it("reads planned cities first, then a rotating floor of the others", () => {
    expect(listingsForRun(slugs, cityOf, plan, 1, 0)).toEqual(["goa", "mumbai", "bangalore"]);
    expect(listingsForRun(slugs, cityOf, plan, 1, 1)).toEqual(["goa", "mumbai", "delhi-ncr"]);
  });

  it("reads everything without a plan", () => {
    expect(listingsForRun(slugs, cityOf, { metros: [], floorSlots: 5 }, 1, 0)).toEqual(slugs);
  });
});

describe("demandCity", () => {
  it.each([
    ["Mumbai", "Mumbai"],
    ["Bombay", "Mumbai"],
    ["Bangalore", "Bengaluru"],
    ["Paris", null],
    ["'; drop table", null],
    [null, null],
  ])("%j → %j", (raw, city) => {
    expect(demandCity(raw)).toBe(city);
  });
});

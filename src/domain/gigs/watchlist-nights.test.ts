import { describe, expect, it } from "vitest";
import type { ValidatedGig } from "./nights";
import { groupNights, nightKey, toGateSource } from "./nights";
import { buildWatchlist, pickForRun, searchedTermMeaning, type WatchSignal } from "./watchlist";

describe("buildWatchlist", () => {
  const signals: WatchSignal[] = [
    { name: "Pritam", origin: "trending", weight: 6975 },
    { name: "The Weeknd", origin: "trending", weight: 6960 },
    { name: "bhuwin", origin: "searched", weight: 4, spotifyId: "6vsLn0UxL3GhtYP7ghpF3t" },
    { name: "Bhuwin", origin: "catalogue", weight: 0, spotifyId: "6vsLn0UxL3GhtYP7ghpF3t" },
    { name: "Prateek Kuhad", origin: "catalogue", weight: 0, spotifyId: "0tC995Rfn9k2l7nqgCZsV7" },
    { name: "DJ", origin: "trending", weight: 1 },
  ];

  it("merges one artist across signals, searched demand first, and drops unsearchable names", () => {
    const list = buildWatchlist(signals, 10);
    expect(list.map((a) => a.name)).toEqual(["Bhuwin", "Prateek Kuhad", "Pritam", "The Weeknd"]);
    expect(list[0]).toMatchObject({
      origins: ["searched", "catalogue"],
      spotifyId: "6vsLn0UxL3GhtYP7ghpF3t",
    });
  });

  it("caps the list", () => {
    expect(buildWatchlist(signals, 2)).toHaveLength(2);
  });
});

describe("pickForRun", () => {
  const list = buildWatchlist(
    [
      { name: "Searched One", origin: "searched", weight: 1 },
      ...["Aa1", "Bb2", "Cc3", "Dd4", "Ee5"].map((name, i) => ({
        name,
        origin: "trending" as const,
        weight: 100 - i,
      })),
    ],
    50,
  );

  it("always takes searched artists, then rotates through the rest", () => {
    const day0 = pickForRun(list, 3, 0).map((a) => a.name);
    const day1 = pickForRun(list, 3, 1).map((a) => a.name);
    expect(day0).toEqual(["Searched One", "Aa1", "Bb2"]);
    expect(day1).toEqual(["Searched One", "Cc3", "Dd4"]);
  });

  it("covers every artist within a few runs", () => {
    const seen = new Set<string>();
    for (let day = 0; day < 3; day++) for (const a of pickForRun(list, 3, day)) seen.add(a.name);
    expect(seen.size).toBe(list.length);
  });

  it("returns nothing for a zero budget", () => {
    expect(pickForRun(list, 0, 0)).toEqual([]);
  });
});

const gig = (over: Partial<ValidatedGig>): ValidatedGig => ({
  source: "artist_site",
  trust: "official",
  externalId: "x",
  url: "https://bhuwin.example.com/live",
  title: "Sketchbook",
  type: "concert",
  startsAt: new Date("2026-12-05T00:00:00+05:30"),
  endsAt: null,
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: null,
  artists: ["Bhuwin"],
  supportActs: [],
  confidence: 0.8,
  ...over,
});

describe("groupNights", () => {
  it("keeps a multi-night run as separate nights (unlike ±1-day festival clustering)", () => {
    const nights = groupNights([
      gig({ externalId: "a#05", startsAt: new Date("2026-12-05T00:00:00+05:30") }),
      gig({ externalId: "a#06", startsAt: new Date("2026-12-06T00:00:00+05:30") }),
      gig({ externalId: "a#09", startsAt: new Date("2026-12-09T00:00:00+05:30") }),
    ]);
    expect(nights.map((n) => n.night)).toEqual(["2026-12-05", "2026-12-06", "2026-12-09"]);
  });

  it("joins independent sources for the same night, city and headliner", () => {
    const [night] = groupNights([
      gig({ externalId: "a" }),
      gig({
        source: "gig_web",
        externalId: "b",
        url: "https://www.rollingstoneindia.com/x",
        city: "Bombay",
      }),
    ]);
    expect(night?.members).toHaveLength(2);
  });

  it("adds a range source to each night it covers, but never makes a night from it", () => {
    const range = gig({
      source: "highape",
      externalId: "r",
      startsAt: new Date("2026-12-05T00:00:00+05:30"),
      endsAt: new Date("2026-12-09T00:00:00+05:30"),
    });
    expect(nightKey(range)).toBeNull();
    const nights = groupNights([gig({ externalId: "a" }), range]);
    expect(nights).toHaveLength(1);
    expect(nights[0]!.members.map((m) => m.externalId)).toEqual(["a", "r"]);
    expect(toGateSource(range).dateRange).toBe(true);
  });

  it("skips candidates without a confirmed headliner", () => {
    expect(groupNights([gig({ artists: [] })])).toEqual([]);
  });
});

describe("searchedTermMeaning", () => {
  const catalogue = [{ name: "Martin Garrix" }, { name: "Diljit Dosanjh" }, { name: "Bhuwin" }];
  it.each([
    ["pune", { kind: "place" }],
    ["Bombay", { kind: "place" }],
    ["garrix", { kind: "catalogue", name: "Martin Garrix" }],
    ["diljit", { kind: "catalogue", name: "Diljit Dosanjh" }],
    ["BHUWIN", { kind: "catalogue", name: "Bhuwin" }],
    ["anuv jain", { kind: "unknown" }],
  ])("%j", (term, meaning) => {
    expect(searchedTermMeaning(term, catalogue)).toEqual(meaning);
  });
});

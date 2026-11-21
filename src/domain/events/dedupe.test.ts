import { describe, expect, it } from "vitest";
import {
  blockingWindow,
  decide,
  dedupeKey,
  duplicateScore,
  eventNameTokens,
  findDuplicate,
  mayOverwrite,
  mergeEventFields,
  isPlaceholderVenue,
  mergeGuard,
  sameBlock,
  sourceRank,
  topSource,
  type DedupeSubject,
} from "./dedupe";

const lolla: DedupeSubject = {
  title: "Lollapalooza India 2026",
  startsAt: new Date("2026-03-07T10:30:00Z"),
  country: "IN",
  city: "Mumbai",
  venueName: "Mahalaxmi Racecourse",
  artistKeys: ["linkin park", "glass animals", "anuv jain"],
};

describe("eventNameTokens", () => {
  it.each([
    ["Lollapalooza India 2026", ["lollapalooza", "india"]],
    ["NH7 Weekender – 15th Edition", ["nh7", "weekender"]],
    ["Sunburn Arena Vol. 3", ["sunburn", "arena"]],
    ["The Zomaland Season 4", ["zomaland"]],
    ["Ed Sheeran: +-=÷x Tour", ["ed", "sheeran", "and", "x", "tour"]],
  ])("%j → %j", (title, tokens) => {
    expect(eventNameTokens(title)).toEqual(tokens);
  });
});

describe("blocking", () => {
  it.each([
    ["same day", {}, true],
    ["next day", { startsAt: new Date("2026-03-08T18:00:00Z") }, true],
    ["day before", { startsAt: new Date("2026-03-06T00:00:00Z") }, true],
    ["two days later", { startsAt: new Date("2026-03-09T10:30:00Z") }, false],
    ["old city name", { city: "Bombay" }, true],
    ["other city", { city: "Pune" }, false],
    ["country case", { country: "in" }, true],
    ["other country", { country: "US" }, false],
  ])("%s → %s", (_label, change, expected) => {
    expect(sameBlock(lolla, { ...lolla, ...change })).toBe(expected);
  });

  it("window spans the UTC day before to the end of the UTC day after", () => {
    expect(blockingWindow(lolla.startsAt)).toEqual({
      from: new Date("2026-03-06T00:00:00.000Z"),
      to: new Date("2026-03-08T23:59:59.999Z"),
    });
  });
});

describe("duplicateScore and decide", () => {
  it.each<[string, Partial<DedupeSubject>, "merge" | "review" | "new"]>([
    ["identical", {}, "merge"],
    [
      "alias venue, edition words, same lineup",
      { title: "Lollapalooza India – 4th Edition", venueName: "Mahalakshmi Race Course, Mumbai" },
      "merge",
    ],
    [
      "same venue and title, lineup mostly overlapping",
      { artistKeys: ["linkin park", "glass animals", "anuv jain", "zaeden"] },
      "merge",
    ],
    ["same venue and title, no lineup yet", { artistKeys: [] }, "review"],
    [
      "same venue, different show",
      { title: "Diljit Dosanjh Dil-Luminati Tour", artistKeys: ["diljit dosanjh"] },
      "new",
    ],
    ["different venue, same title, same lineup", { venueName: "Jio World Garden" }, "review"],
  ])("%s → %s", (_label, change, expected) => {
    expect(decide(duplicateScore(lolla, { ...lolla, ...change }))).toBe(expected);
  });

  it.each([
    [0.85, "merge"],
    [0.8499, "review"],
    [0.6, "review"],
    [0.5999, "new"],
  ] as const)("threshold %f → %s", (score, decision) => {
    expect(decide(score)).toBe(decision);
  });

  it("is symmetric", () => {
    const other = { ...lolla, title: "Lollapalooza India", artistKeys: ["linkin park"] };
    expect(duplicateScore(lolla, other)).toBeCloseTo(duplicateScore(other, lolla));
  });
});

describe("findDuplicate", () => {
  it("picks the best candidate in the block", () => {
    const weaker = { ...lolla, id: "weak", artistKeys: ["someone else"] };
    const best = { ...lolla, id: "best" };
    const outOfBlock = { ...lolla, id: "far", startsAt: new Date("2026-04-01T00:00:00Z") };
    const match = findDuplicate(lolla, [weaker, outOfBlock, best]);
    expect(match.decision).toBe("merge");
    expect(match.candidate?.id).toBe("best");
  });

  it("ignores candidates outside the block even when they score high", () => {
    const outOfBlock = { ...lolla, city: "Pune" };
    expect(findDuplicate(lolla, [outOfBlock])).toEqual({
      decision: "new",
      candidate: null,
      score: 0,
    });
  });

  it("returns new with no candidate when the best score is low", () => {
    const other = {
      ...lolla,
      title: "Comedy Night",
      venueName: "Canvas Laugh Club",
      artistKeys: [],
    };
    const match = findDuplicate(lolla, [other]);
    expect(match.decision).toBe("new");
    expect(match.candidate).toBeNull();
  });
});

describe("dedupeKey", () => {
  it.each([
    [
      "Lollapalooza India 2026",
      "2026-03-07T10:30:00Z",
      "Bombay",
      "lollapalooza india|2026-03-07|mumbai",
    ],
    [
      "LOLLAPALOOZA INDIA",
      "2026-03-07T20:00:00Z",
      "Mumbai",
      "lollapalooza india|2026-03-07|mumbai",
    ],
    ["Sunburn Goa", "2026-12-28T09:00:00Z", "Vagator", "sunburn goa|2026-12-28|goa"],
    ["2026", "2026-01-01T00:00:00Z", "Pune", "2026|2026-01-01|pune"],
  ])("%j on %s in %s → %s", (title, iso, city, key) => {
    expect(dedupeKey({ title, startsAt: new Date(iso), city })).toBe(key);
  });
});

describe("source precedence", () => {
  it("ranks admin > jambase > ticketmaster > user_submission", () => {
    expect(sourceRank("admin")).toBeGreaterThan(sourceRank("jambase"));
    expect(sourceRank("jambase")).toBeGreaterThan(sourceRank("ticketmaster"));
    expect(sourceRank("ticketmaster")).toBeGreaterThan(sourceRank("user_submission"));
  });

  it.each([
    [["ticketmaster", "admin"], "admin"],
    [["user_submission", "ticketmaster"], "ticketmaster"],
    [[], null],
  ] as const)("topSource(%j) = %s", (sources, top) => {
    expect(topSource(sources)).toBe(top);
  });

  it.each([
    ["admin", ["ticketmaster"], true],
    ["ticketmaster", ["ticketmaster"], true],
    ["ticketmaster", ["admin", "ticketmaster"], false],
    ["user_submission", [], true],
  ] as const)("%s may overwrite %j → %s", (incoming, existing, expected) => {
    expect(mayOverwrite(incoming, existing)).toBe(expected);
  });
});

describe("mergeEventFields", () => {
  const existing = {
    title: "Lolla",
    genre: null as string | null,
    imageUrl: "a.jpg" as string | null,
  };

  it.each([
    [
      "overwrite: known values win",
      { title: "Lollapalooza", genre: "Rock" },
      true,
      { title: "Lollapalooza", genre: "Rock", imageUrl: "a.jpg" },
    ],
    ["overwrite: null clears", { imageUrl: null }, true, { ...existing, imageUrl: null }],
    ["overwrite: undefined is unknown", { title: undefined }, true, existing],
    [
      "lower source: only fills nulls",
      { title: "X", genre: "Pop", imageUrl: "b.jpg" },
      false,
      { title: "Lolla", genre: "Pop", imageUrl: "a.jpg" },
    ],
  ] as const)("%s", (_label, incoming, overwrite, expected) => {
    expect(mergeEventFields(existing, incoming, overwrite)).toEqual(expected);
  });
});

describe("D-072: separate nights are never merged", () => {
  /** "Sketchbook by Bhuwin Khursija – Mumbai", 19:30 IST on the given December day. */
  const night = (day: number, over: Partial<DedupeSubject> = {}): DedupeSubject => ({
    title: "Sketchbook by Bhuwin Khursija – Mumbai",
    startsAt: new Date(Date.UTC(2026, 11, day, 14, 0)),
    country: "IN",
    city: "Mumbai",
    venueName: "NSCI Dome",
    artistKeys: ["bhuwin khursija"],
    startsAtDateOnly: false,
    sources: ["admin"],
    ...over,
  });
  /** 00:15 IST on the 6th: the UTC date is still the 5th. */
  const slipped = new Date(Date.UTC(2026, 11, 5, 18, 45));

  it.each<[string, DedupeSubject, DedupeSubject, "allow" | "review" | "never"]>([
    ["same night, same source", night(5), night(5), "allow"],
    ["residency: next night, admin", night(5), night(6), "never"],
    [
      "residency: next night, one feed",
      night(5, { sources: ["ticketmaster"] }),
      night(6, { sources: ["ticketmaster"] }),
      "never",
    ],
    ["admin on one side only", night(5, { sources: ["ticketmaster"] }), night(6), "never"],
    [
      "two sources, 1-day slip",
      night(5, { sources: ["ticketmaster"] }),
      night(6, { sources: ["sunburn"], startsAt: slipped }),
      "review",
    ],
    [
      "date-only vs timed, same feed",
      night(5, { sources: ["ticketmaster"] }),
      night(6, { sources: ["ticketmaster"], startsAtDateOnly: true }),
      "review",
    ],
    ["date-only vs timed, admin", night(5), night(6, { startsAtDateOnly: true }), "review"],
    [
      "unknown flags count as timed",
      night(5, { startsAtDateOnly: undefined }),
      night(6, { startsAtDateOnly: undefined }),
      "never",
    ],
  ])("%s → %s", (_label, a, b, expected) => {
    expect(mergeGuard(a, b)).toBe(expected);
    expect(mergeGuard(b, a)).toBe(expected);
  });

  it("the residency scores as a merge on content alone, which is why the guard exists", () => {
    expect(decide(duplicateScore(night(5), night(6)))).toBe("merge");
  });

  it.each(["TBA", "Venue TBD", "To be announced", "tbc", "Secret location", "N/A"])(
    "a placeholder venue %j is no evidence of the same place",
    (venueName) => {
      const a = night(5, { venueName });
      expect(isPlaceholderVenue(venueName)).toBe(true);
      expect(duplicateScore(a, night(5, { venueName }))).toBeCloseTo(0.6);
    },
  );

  it.each(["NSCI Dome", "TBA Lounge", "Bandra Fort"])("%j is a real venue", (venueName) => {
    expect(isPlaceholderVenue(venueName)).toBe(false);
  });

  it("residency 5/6/9 Dec: each night is new against the others", () => {
    const stored = [
      { ...night(5), id: "dec5" },
      { ...night(6), id: "dec6" },
    ];
    expect(findDuplicate(night(6), [stored[0]!])).toMatchObject({
      decision: "new",
      candidate: null,
    });
    expect(findDuplicate(night(9), stored)).toMatchObject({ decision: "new", candidate: null });
    expect(findDuplicate(night(5), stored)).toMatchObject({
      decision: "merge",
      candidate: { id: "dec5" },
    });
  });

  it("same night from two sources with a 1-day slip is review, never an auto-merge", () => {
    const stored = { ...night(5, { sources: ["ticketmaster"] }), id: "tm" };
    const incoming = night(6, { sources: ["sunburn"], startsAt: slipped });
    expect(duplicateScore(incoming, stored)).toBeGreaterThanOrEqual(0.6);
    expect(findDuplicate(incoming, [stored])).toMatchObject({
      decision: "review",
      candidate: { id: "tm" },
    });
  });

  it("date-only vs timed on different local dates is review", () => {
    const stored = { ...night(5, { sources: ["ticketmaster"] }), id: "tm" };
    const incoming = night(6, {
      sources: ["wikipedia"],
      startsAtDateOnly: true,
      startsAt: new Date(Date.UTC(2026, 11, 5, 18, 30)),
    });
    expect(findDuplicate(incoming, [stored])).toMatchObject({ decision: "review" });
  });

  it("the best allowed candidate wins over a better-scoring forbidden one", () => {
    const sameNight = { ...night(5, { title: "Sketchbook Mumbai" }), id: "same-night" };
    const nextNight = { ...night(6), id: "next-night" };
    const match = findDuplicate(night(5), [nextNight, sameNight]);
    expect(match.candidate?.id).toBe("same-night");
  });
});

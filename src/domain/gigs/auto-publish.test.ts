import { describe, expect, it } from "vitest";
import {
  autoPublishDecision,
  groundingGaps,
  type GateInput,
  type GateSource,
} from "./auto-publish";

const now = new Date("2026-11-21T10:00:00Z");

/** The artist's own page: every field quoted. */
const official: GateSource = {
  url: "https://bhuwin.example.com/live",
  domain: "bhuwin.example.com",
  officialKind: "artist",
  title: "Sketchbook",
  night: "2026-12-05",
  startTime: "19:30",
  dateOnly: false,
  dateRange: false,
  city: "Mumbai",
  artists: ["Bhuwin"],
  quotes: {
    title: "SKETCHBOOK Unfinished Notes",
    date: "05th, 06th & 09th December 2026",
    time: "7:30 PM",
    city: "Mumbai - OML HQ, Andheri",
    headliner: "OML REPRESENTATION Bhuwin experience",
  },
  cancelled: false,
};
/** A second, independent page (news) agreeing on every field. */
const outlet: GateSource = {
  ...official,
  url: "https://www.rollingstoneindia.com/bhuwin-sketchbook",
  domain: "rollingstoneindia.com",
  officialKind: null,
  title: "Bhuwin Live in Mumbai",
  quotes: {},
};

const input = (over: Partial<GateInput> = {}): GateInput => ({
  now,
  sources: [official, outlet],
  headlinerMatch: "auto",
  archivedLineups: [],
  confidence: 0.92,
  ...over,
});

const failed = (i: GateInput) =>
  autoPublishDecision(i)
    .checks.filter((c) => !c.ok)
    .map((c) => c.rule);

describe("autoPublishDecision", () => {
  it("publishes only when every rule holds", () => {
    const d = autoPublishDecision(input());
    expect(d.decision).toBe("publish");
    expect(d.reasons).toEqual([]);
    expect(d.checks.every((c) => c.ok)).toBe(true);
  });

  describe("rule 1: two independent sources, one official", () => {
    it("holds a single source", () => {
      expect(autoPublishDecision(input({ sources: [official] })).decision).toBe("hold");
      expect(failed(input({ sources: [official] }))).toEqual(["independent_sources"]);
    });

    it("counts two pages on one registrable domain once (mirrors, subdomains)", () => {
      const mirror = { ...official, url: "https://m.bhuwin.example.com/live" };
      expect(failed(input({ sources: [official, mirror] }))).toContain("independent_sources");
    });

    it("holds two non-official sources", () => {
      const other = { ...outlet, domain: "djmag.com", url: "https://djmag.com/x" };
      expect(failed(input({ sources: [outlet, other] }))).toEqual(
        expect.arrayContaining(["independent_sources", "official_grounded"]),
      );
    });

    it("doesn't count a listing range as a source for one night", () => {
      const range = { ...outlet, dateRange: true };
      expect(failed(input({ sources: [official, range] }))).toContain("independent_sources");
    });
  });

  describe("rule 2: grounded on the official source", () => {
    it.each([
      ["title", { title: "Something else" }],
      ["date", { date: "December 2026" }],
      ["time", { time: "8 PM" }],
      ["city", { city: "Pune" }],
      ["headliner", { headliner: "an evening of music" }],
    ])("holds when the %s quote doesn't state the value", (field, quotes) => {
      const bad = { ...official, quotes: { ...official.quotes, ...quotes } };
      expect(groundingGaps(bad)).toEqual([field]);
      expect(autoPublishDecision(input({ sources: [bad, outlet] })).decision).toBe("hold");
    });

    it("accepts an explicit date-only page without a time quote", () => {
      const dateOnly = {
        ...official,
        startTime: null,
        dateOnly: true,
        quotes: { ...official.quotes, time: undefined },
      };
      expect(groundingGaps(dateOnly)).toEqual([]);
      const plain = {
        ...official,
        startTime: null,
        dateOnly: false,
        quotes: { ...official.quotes, time: undefined },
      };
      expect(groundingGaps(plain)).toEqual(["time"]);
    });

    it("accepts a composed title only when its headliner and city are grounded", () => {
      const composed = {
        ...official,
        title: "Bhuwin Live in Mumbai",
        quotes: { ...official.quotes, title: undefined },
      };
      expect(groundingGaps(composed)).toEqual([]);
      expect(
        groundingGaps({ ...composed, quotes: { ...composed.quotes, headliner: "music" } }),
      ).toEqual(["title", "headliner"]);
    });
  });

  describe("rule 3: no conflicts (never majority wins)", () => {
    it.each([
      ["date", { night: "2026-12-06" }],
      ["city", { city: "Pune" }],
      ["time", { startTime: "20:00" }],
      ["headliner", { artists: ["Somebody Else"] }],
    ])("holds on a %s conflict", (_field, change) => {
      const third = { ...outlet, domain: "djmag.com", url: "https://djmag.com/y" };
      const disagreeing = { ...outlet, ...change };
      const d = autoPublishDecision(input({ sources: [official, third, disagreeing] }));
      expect(d.decision).toBe("hold");
      expect(d.checks.find((c) => c.rule === "no_conflicts")?.ok).toBe(false);
    });
  });

  describe("rule 4: future, ≤ 18 months, explicit year", () => {
    it("rejects a past night", () => {
      const past = (s: GateSource) => ({
        ...s,
        night: "2026-11-01",
        quotes: { ...s.quotes, date: "1 November 2026" },
      });
      expect(autoPublishDecision(input({ sources: [past(official), past(outlet)] })).decision).toBe(
        "reject",
      );
    });

    it("rejects a night more than 18 months away", () => {
      const far = (s: GateSource) => ({
        ...s,
        night: "2028-07-01",
        quotes: { ...s.quotes, date: "1 July 2028" },
      });
      expect(autoPublishDecision(input({ sources: [far(official), far(outlet)] })).decision).toBe(
        "reject",
      );
    });

    it("holds when the official page doesn't write the year", () => {
      const noYear = {
        ...official,
        quotes: { ...official.quotes, date: "5th, 6th and 9th December" },
      };
      expect(failed(input({ sources: [noYear, outlet] }))).toEqual(["official_grounded"]);
    });
  });

  it("rule 5: holds an unmatched or uncertain headliner, accepts a Lead-confirmed one", () => {
    for (const m of [null, "pending", "needs_review", "not_found"] as const) {
      expect(failed(input({ headlinerMatch: m }))).toEqual(["headliner_matched"]);
    }
    expect(autoPublishDecision(input({ headlinerMatch: "manual" })).decision).toBe("publish");
  });

  it("rule 7: holds under 0.9 confidence", () => {
    expect(failed(input({ confidence: 0.89 }))).toEqual(["confidence"]);
  });

  it("rule 8: holds when any source says cancelled", () => {
    expect(failed(input({ sources: [official, { ...outlet, cancelled: true }] }))).toEqual([
      "not_cancelled",
    ]);
  });

  // ── Regressions for the two past incidents ───────────────────────────────

  it("REGRESSION D-054: Ed Sheeran's 2025 India leg read as 2027 is never published", () => {
    // The tour table said "15 March" with no year; the year 2027 was guessed.
    const wiki: GateSource = {
      url: "https://en.wikipedia.org/wiki/Mathematics_Tour",
      domain: "wikipedia.org",
      officialKind: null,
      title: "Ed Sheeran Live in Mumbai",
      night: "2027-03-16",
      startTime: null,
      dateOnly: true,
      dateRange: false,
      city: "Mumbai",
      artists: ["Ed Sheeran", "Prateek Kuhad"],
      quotes: { date: "16 March", city: "Mumbai", headliner: "Ed Sheeran" },
      cancelled: false,
    };
    const guessed = autoPublishDecision(
      input({ sources: [wiki], headlinerMatch: "auto", confidence: 0.95 }),
    );
    expect(guessed.decision).not.toBe("publish");
    // Even an "official" copy of the guessed date can't pass: its quote has no year.
    const officialCopy = {
      ...wiki,
      officialKind: "organiser" as const,
      domain: "organiser.example",
    };
    const d = autoPublishDecision(input({ sources: [officialCopy, wiki], confidence: 0.95 }));
    expect(d.decision).toBe("hold");
    expect(d.reasons.join(" ")).toMatch(/official_grounded: .*date/u);
    // And the real dates (2025) are in the past: rejected outright.
    const real = (s: GateSource) => ({
      ...s,
      night: "2025-03-16",
      quotes: { ...s.quotes, date: "16 March 2025" },
    });
    expect(autoPublishDecision(input({ sources: [real(officialCopy), real(wiki)] })).decision).toBe(
      "reject",
    );
  });

  it("REGRESSION D-055: Sunburn 2026 with the 2013–15 lineup is rejected as a re-run", () => {
    const oldLineup = ["Paul van Dyk", "Afrojack", "Nicky Romero"];
    const sunburn = (domain: string, officialKind: GateSource["officialKind"]): GateSource => ({
      url: `https://${domain}/sunburn-2026`,
      domain,
      officialKind,
      title: "Sunburn Festival 2026",
      night: "2026-12-27",
      startTime: null,
      dateOnly: true,
      dateRange: false,
      city: "Goa",
      artists: oldLineup,
      quotes: {
        title: "Sunburn Festival 2026",
        date: "27 December 2026",
        city: "Vagator, Goa",
        headliner: "Paul van Dyk",
      },
      cancelled: false,
    });
    const d = autoPublishDecision(
      input({
        sources: [sunburn("sunburn.in", "organiser"), sunburn("wikipedia.org", null)],
        archivedLineups: [["Nicky Romero", "paul van dyk", "Afrojack"]],
        confidence: 0.95,
      }),
    );
    expect(d.decision).toBe("reject");
    expect(d.reasons).toEqual([expect.stringMatching(/^not_a_rerun/u)]);
  });
});

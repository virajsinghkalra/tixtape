import { describe, expect, it } from "vitest";
import type { ValidatedCandidate } from "./candidate";
import {
  artistOverlap,
  clusterCandidates,
  decidePublication,
  mergeCluster,
  sameEvent,
} from "./corroborate";

const base: ValidatedCandidate = {
  source: "rollingstone",
  trust: "trusted",
  externalId: "rs-1",
  url: "https://rollingstoneindia.com/a/",
  title: "Johnnie & Co. Festival",
  type: "festival",
  startsAt: new Date("2027-02-13T00:00:00+05:30"),
  endsAt: null,
  city: "Mumbai",
  country: "IN",
  venueName: "Mahalaxmi Racecourse",
  artists: ["Charlie Puth", "Ellie Goulding", "Kayan"],
  supportActs: [],
  dateExplicit: true,
  confidence: 0.9,
};
const c = (over: Partial<ValidatedCandidate>): ValidatedCandidate => ({ ...base, ...over });

const official = c({
  source: "teaminnovation",
  trust: "official",
  externalId: "ti-1",
  url: "https://teaminnovation.in/upcoming-show/x.html",
  title: "Johnnie & Co. Music Festival",
  venueName: null,
  artists: ["Charlie Puth"],
  confidence: 0.8,
});

describe("artistOverlap", () => {
  it.each([
    [["A", "B", "C"], ["a", "b", "D"], 2 / 3],
    [["Charlie Puth"], ["Charlie Puth", "Ellie Goulding"], 1],
    [["Above & Beyond"], ["Above and Beyond"], 1],
    [[], ["A"], 0],
  ])("%j vs %j", (a, b, expected) => {
    expect(artistOverlap(a, b)).toBeCloseTo(expected);
  });
});

describe("sameEvent", () => {
  it.each([
    ["same name in another wording", official, true],
    [
      "one day apart",
      c({ source: "pollstar", startsAt: new Date("2027-02-14T00:00:00+05:30") }),
      true,
    ],
    [
      "two days apart",
      c({ source: "pollstar", startsAt: new Date("2027-02-15T00:00:00+05:30") }),
      false,
    ],
    ["another city", c({ source: "pollstar", city: "Pune" }), false],
    ["old city name", c({ source: "pollstar", city: "Bombay" }), true],
    [
      "different name, same artists",
      c({
        source: "pollstar",
        title: "Charlie Puth Live",
        artists: ["Charlie Puth", "Ellie Goulding"],
      }),
      true,
    ],
    [
      "different name and artists",
      c({ source: "pollstar", title: "Bandland", artists: ["Opeth"] }),
      false,
    ],
  ])("%s → %s", (_, other, expected) => {
    expect(sameEvent(base, other)).toBe(expected);
  });
});

describe("decidePublication", () => {
  it("publishes an official source plus a trusted outlet", () => {
    expect(decidePublication([base, official])).toEqual({
      published: true,
      reason: "official_and_trusted",
    });
  });

  it("publishes two outlets whose artists overlap by at least 70%", () => {
    const pollstar = c({
      source: "pollstar",
      artists: ["Charlie Puth", "Ellie Goulding", "Kayan", "Gini"],
    });
    expect(decidePublication([base, pollstar])).toEqual({
      published: true,
      reason: "sources_agree",
    });
  });

  it("keeps two outlets that disagree on artists unpublished", () => {
    const pollstar = c({ source: "pollstar", artists: ["Charlie Puth", "Opeth", "Gini"] });
    expect(decidePublication([base, pollstar])).toEqual({
      published: false,
      reason: "no_agreement",
    });
  });

  it("keeps two outlets with no confirmed artists unpublished", () => {
    expect(decidePublication([c({ artists: [] }), c({ source: "pollstar", artists: [] })])).toEqual(
      { published: false, reason: "no_agreement" },
    );
  });

  it("keeps a single source unpublished, even repeated", () => {
    expect(decidePublication([base, c({ externalId: "rs-2" })])).toEqual({
      published: false,
      reason: "single_source",
    });
  });
});

describe("clusterCandidates / mergeCluster", () => {
  it("groups the same event and merges facts with the official source first", () => {
    const other = c({ source: "pollstar", title: "Bandland", city: "Bengaluru", artists: [] });
    const clusters = clusterCandidates([base, other, official]);
    expect(clusters.map((cl) => cl.map((x) => x.externalId))).toEqual([["rs-1", "ti-1"], ["rs-1"]]);
    const merged = mergeCluster(clusters[0]!);
    expect(merged).toMatchObject({
      title: "Johnnie & Co. Music Festival",
      venueName: "Mahalaxmi Racecourse",
      city: "Mumbai",
      artists: ["Charlie Puth", "Ellie Goulding", "Kayan"],
    });
    expect(merged.sources.map((s) => s.source)).toEqual(["teaminnovation", "rollingstone"]);
  });
});

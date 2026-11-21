import { describe, expect, it } from "vitest";
import type { ValidatedCandidate } from "./candidate";
import {
  artistOverlap,
  clusterCandidates,
  decidePublication,
  mergeCluster,
  recurringBrandWords,
  sameEvent,
  titleHeadliners,
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

describe("D-078: club nights are not clustered on brand words", () => {
  /** Real titles and venues from the HighApe fixtures (Bengaluru, Nov 2026). */
  const gig = (over: Partial<ValidatedCandidate>): ValidatedCandidate =>
    c({
      source: "highape",
      trust: "official",
      type: "concert",
      city: "Bengaluru",
      startsAt: new Date("2026-11-21T20:00:00+05:30"),
      venueName: "DND",
      artists: [],
      ...over,
    });
  const crossover = (dj: string, externalId: string) =>
    gig({ externalId, title: `CROSS/OVER Ft ${dj}`, artists: [dj] });
  const hod = (title: string, artist: string, externalId: string) =>
    gig({
      externalId,
      title,
      artists: [artist],
      venueName: "HOD - House Of Dopamine Brewery LLP",
      startsAt: new Date("2026-11-22T20:00:00+05:30"),
    });

  it.each<[string, ValidatedCandidate, ValidatedCandidate, boolean]>([
    [
      "same brand, different DJ in the title (was a 0.6 title match)",
      crossover("Nikhil Chinapa", "h1"),
      crossover("Anish Sood", "h2"),
      false,
    ],
    [
      "same brand, different DJ, titles only (no artist lists)",
      gig({ externalId: "h1", title: "CROSS/OVER Ft Nikhil Chinapa" }),
      gig({ externalId: "h2", title: "CROSS/OVER Ft Anish Sood" }),
      false,
    ],
    [
      "two HOD Club nights with different live acts on the same night",
      hod("War Drum | James Mithal Live at HOD Club", "James Mithal", "h3"),
      hod("Black Friday | Karthik Gopinath live at HOD CLUB", "Karthik Gopinath", "h4"),
      false,
    ],
    [
      "generic '<Brand> Night ft. DJ X' vs 'ft. DJ Y', one day apart",
      gig({ externalId: "h5", title: "Techno Night ft. DJ Kohra" }),
      gig({
        externalId: "h6",
        title: "Techno Night ft. DJ Arjun Vagale",
        startsAt: new Date("2026-11-22T20:00:00+05:30"),
      }),
      false,
    ],
    [
      "only generic words in common",
      gig({ externalId: "h7", title: "Saturday Night Live Party at the Club" }),
      gig({ externalId: "h8", title: "Live Music Night at the Club" }),
      false,
    ],
    [
      "same venue and IST date, different headliner, generic titles",
      gig({ externalId: "h9", title: "Friday Night Live", artists: ["Kohra"] }),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r1",
        title: "Friday Night Live",
        artists: ["Arjun Vagale"],
      }),
      false,
    ],
    [
      "same venue and IST date, different first artist, but the sources agree",
      gig({ externalId: "h10", title: "Friday Night Live", artists: ["Kohra", "Arjun Vagale"] }),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r2",
        title: "Friday Night Live",
        artists: ["Arjun Vagale", "Kohra"],
      }),
      true,
    ],
    [
      "one listing, the same brand title on consecutive nights at one venue",
      gig({ externalId: "fri", title: "Bollywood Night", artists: ["DJ Aqeel"] }),
      gig({
        externalId: "sat",
        title: "Bollywood Night",
        artists: ["DJ Suketu"],
        startsAt: new Date("2026-11-22T20:00:00+05:30"),
      }),
      false,
    ],
    [
      "two sources, same title, one day apart (a date slip) still cluster",
      gig({ externalId: "h12", title: "Bollywood Night", artists: ["DJ Aqeel"] }),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r5",
        title: "Bollywood Night",
        artists: ["DJ Aqeel"],
        startsAt: new Date("2026-11-22T20:00:00+05:30"),
      }),
      true,
    ],
    [
      "the same club night listed by two sources",
      crossover("Nikhil Chinapa", "h1"),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r3",
        title: "CROSS/OVER feat. Nikhil Chinapa",
        artists: ["Nikhil Chinapa"],
      }),
      true,
    ],
    [
      "same headliner, one title names a support act too",
      gig({
        externalId: "h11",
        title: "Ed Sheeran ft. Calum Scott",
        artists: ["Ed Sheeran", "Calum Scott"],
      }),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r4",
        title: "Ed Sheeran Live in Bengaluru",
        artists: ["Ed Sheeran"],
      }),
      true,
    ],
  ])("%s → %s", (_label, a, b, expected) => {
    expect(sameEvent(a, b)).toBe(expected);
    expect(sameEvent(b, a)).toBe(expected);
  });

  it.each<[string, string[]]>([
    ["CROSS/OVER Ft Nikhil Chinapa", ["nikhil chinapa"]],
    ["War Drum | James Mithal Live at HOD Club", ["james mithal"]],
    ["Black Friday | Karthik Gopinath live at HOD CLUB", ["karthik gopinath"]],
    ["Techno Night ft. DJ Kohra b2b Arjun Vagale", ["kohra", "arjun vagale"]],
    ["Sundowner Pool Party – Sunset Vibes & Poolside Beats", []],
    ["Johnnie & Co. Festival", []],
  ])("titleHeadliners(%j) → %j", (title, names) => {
    expect([...titleHeadliners(gig({ title }))].sort()).toEqual([...names].sort());
  });

  it("a brand that recurs weekly carries no title similarity; one festival weekend is not a brand", () => {
    const weekly = [0, 7, 14].map((d, i) =>
      gig({
        externalId: `w${i}`,
        title: `CROSS/OVER Ft ${["Nikhil Chinapa", "Anish Sood", "Kohra"][i]}`,
        startsAt: new Date(Date.parse("2026-11-21T20:00:00+05:30") + d * 86_400_000),
      }),
    );
    const festival = [0, 1, 2].map((d, i) =>
      c({
        externalId: `f${i}`,
        title: "Sunburn Goa",
        city: "Goa",
        startsAt: new Date(Date.parse("2026-12-28T16:00:00+05:30") + d * 86_400_000),
      }),
    );
    const brands = recurringBrandWords([...weekly, ...festival]);
    expect([...brands].sort()).toEqual(["cross", "over"]);
    // With the brand ignored, two bare CROSS/OVER listings on one night no longer match by title.
    const bare = (id: string) => gig({ externalId: id, title: "CROSS/OVER", artists: [] });
    expect(sameEvent(bare("b1"), bare("b2"))).toBe(true);
    expect(sameEvent(bare("b1"), bare("b2"), brands)).toBe(false);
  });

  it("clusterCandidates keeps every HighApe night separate and still joins a real duplicate", () => {
    const nights = [
      crossover("Nikhil Chinapa", "h1"),
      crossover("Anish Sood", "h2"),
      hod("War Drum | James Mithal Live at HOD Club", "James Mithal", "h3"),
      hod("Black Friday | Karthik Gopinath live at HOD CLUB", "Karthik Gopinath", "h4"),
      gig({
        source: "rollingstone",
        trust: "trusted",
        externalId: "r3",
        title: "CROSS/OVER feat. Nikhil Chinapa",
        artists: ["Nikhil Chinapa"],
      }),
    ];
    expect(clusterCandidates(nights).map((cl) => cl.map((x) => x.externalId))).toEqual([
      ["h1", "r3"],
      ["h2"],
      ["h3"],
      ["h4"],
    ]);
  });
});

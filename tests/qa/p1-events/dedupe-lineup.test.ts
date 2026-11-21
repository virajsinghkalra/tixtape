import { EVENT_SOURCES } from "@/domain/shared/lineup";
/**
 * QA P1.5 (dedupe) and lineup rules: LLD §5.3, D-026, D-027.
 */
import { describe, expect, it } from "vitest";
import {
  SOURCE_PRECEDENCE,
  blockingWindow,
  decide,
  dedupeKey,
  duplicateScore,
  eventNameTokens,
  findDuplicate,
  mayOverwrite,
  mergeEventFields,
  sameBlock,
  type DedupeSubject,
} from "@/domain/events/dedupe";
import { buildLineup, lineupHash, tierFromAttractionOrder } from "@/domain/events/lineup";
import { RawEventSchema, type RawLineupEntry } from "@/domain/events/raw-event";
import { diceOverlap } from "@/domain/events/similarity";

const H = 3_600_000;
const subj = (over: Partial<DedupeSubject> = {}): DedupeSubject => ({
  title: "Lollapalooza India",
  startsAt: new Date("2026-12-01T12:00:00Z"),
  country: "IN",
  city: "Mumbai",
  venueName: "Mahalaxmi Racecourse",
  artistKeys: ["a", "b", "c"],
  ...over,
});

describe("QA blocking (country + city + date ±1 day)", () => {
  it("blockingWindow covers at least ±24h around the start", () => {
    const t = new Date("2026-12-01T12:00:00Z");
    const w = blockingWindow(t);
    expect(w.from.getTime()).toBeLessThanOrEqual(t.getTime() - 24 * H);
    expect(w.to.getTime()).toBeGreaterThanOrEqual(t.getTime() + 24 * H);
    expect(w.to.getTime() - w.from.getTime()).toBeLessThanOrEqual(72 * H);
  });

  it("exactly 24h apart is the same block (both directions)", () => {
    const a = subj({ startsAt: new Date("2026-12-01T00:00:00Z") });
    const b = subj({ startsAt: new Date("2026-12-02T00:00:00Z") });
    expect(sameBlock(a, b)).toBe(true);
    expect(sameBlock(b, a)).toBe(true);
  });

  it("24h+1s across two UTC dates is outside the block", () => {
    const a = subj({ startsAt: new Date("2026-12-01T23:59:59Z") });
    const b = subj({ startsAt: new Date("2026-12-03T00:00:00Z") });
    expect(sameBlock(a, b)).toBe(false);
    expect(sameBlock(b, a)).toBe(false);
  });

  it("an IST late-night show crossing UTC midnight still blocks with its local-date twin", () => {
    // 01:00 IST on 2 Dec = 19:30Z on 1 Dec; a source reporting 23:00 IST on 1 Dec = 17:30Z.
    const a = subj({ startsAt: new Date("2026-12-02T01:00:00+05:30") });
    const b = subj({ startsAt: new Date("2026-12-01T23:00:00+05:30") });
    expect(sameBlock(a, b)).toBe(true);
  });

  it("sameBlock agrees with blockingWindow", () => {
    const a = subj({ startsAt: new Date("2026-12-01T05:00:00Z") });
    const w = blockingWindow(a.startsAt);
    expect(sameBlock(a, subj({ startsAt: w.from }))).toBe(true);
    expect(sameBlock(a, subj({ startsAt: w.to }))).toBe(true);
    expect(sameBlock(a, subj({ startsAt: new Date(w.to.getTime() + 1000) }))).toBe(false);
    expect(sameBlock(a, subj({ startsAt: new Date(w.from.getTime() - 1000) }))).toBe(false);
  });

  it("city aliases block together; other city / country does not", () => {
    expect(sameBlock(subj({ city: "Bombay" }), subj({ city: "Mumbai" }))).toBe(true);
    expect(sameBlock(subj({ city: "Bangalore" }), subj({ city: "Bengaluru" }))).toBe(true);
    expect(sameBlock(subj({ city: "Pune" }), subj({ city: "Mumbai" }))).toBe(false);
    expect(sameBlock(subj({ country: "US" }), subj())).toBe(false);
  });
});

describe("QA eventNameTokens (year and edition stripped)", () => {
  it.each([
    ["Lollapalooza India 2026", "Lollapalooza India"],
    ["NH7 Weekender 2026 - 10th Edition", "NH7 Weekender"],
    ["Sunburn Festival: 2nd edition", "Sunburn Festival"],
    ["LOLLAPALOOZA  india!", "lollapalooza india"],
  ])("%j ≡ %j", (a, b) => {
    expect(eventNameTokens(a)).toEqual(eventNameTokens(b));
  });

  it("does not strip meaningful numbers like the 7 in NH7", () => {
    expect(eventNameTokens("NH7 Weekender")).not.toEqual(eventNameTokens("Weekender"));
  });
});

describe("QA duplicateScore / decide", () => {
  it("identical subjects score 1; result in [0,1] and symmetric", () => {
    expect(duplicateScore(subj(), subj())).toBeCloseTo(1, 12);
    const a = subj();
    const b = subj({ title: "Something Else", venueName: "NSCI Dome", artistKeys: ["z"] });
    const s = duplicateScore(a, b);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(duplicateScore(b, a)).toBeCloseTo(s, 12);
  });

  it("thresholds: 0.85 merges, 0.6 reviews (inclusive)", () => {
    expect(decide(1)).toBe("merge");
    expect(decide(0.85)).toBe("merge");
    expect(decide(0.8499)).toBe("review");
    expect(decide(0.6)).toBe("review");
    expect(decide(0.5999)).toBe("new");
    expect(decide(0)).toBe("new");
  });

  it("weights are 0.4 venue / 0.3 title / 0.3 artists", () => {
    const base = subj();
    // Only the artists differ completely: 0.4 + 0.3 + 0 = 0.7
    expect(duplicateScore(base, subj({ artistKeys: ["x", "y"] }))).toBeCloseTo(0.7, 9);
    // Only the title differs completely: 0.4 + 0 + 0.3 = 0.7
    expect(duplicateScore(base, subj({ title: "Zzz Qqq" }))).toBeCloseTo(0.7, 9);
  });

  it("a spec-exact 0.85 (venue 1, title 1, artists 0.5) is an auto-merge", () => {
    const a = subj({ artistKeys: ["a", "b"] });
    const b = subj({ artistKeys: ["a", "b", "c", "d"] }); // jaccard = 0.5
    const s = duplicateScore(a, b);
    expect(s).toBeCloseTo(0.85, 9);
    expect(decide(s)).toBe("merge");
  });

  it("a spec-exact 0.85 (venue 1, title dice 0.5, artists 1) is an auto-merge", () => {
    const a = subj({ title: "Sunburn Arena" });
    const b = subj({ title: "Arena Nights" });
    // precondition: Dice over title tokens is exactly 0.5 (2·1/(2+2) after any stripping)
    const d = diceOverlap(eventNameTokens(a.title), eventNameTokens(b.title));
    expect(d).toBe(0.5);
    const s = duplicateScore(a, b);
    expect(s).toBeCloseTo(0.85, 9);
    expect(decide(s)).toBe("merge");
  });

  it("a spec-exact 0.6 (venue 1, title 0, artists 2/3) goes to review", () => {
    const a = subj({ title: "Alpha", artistKeys: ["a", "b", "c"] });
    const b = subj({ title: "Omega", artistKeys: ["a", "b"] }); // jaccard 2/3
    const s = duplicateScore(a, b);
    expect(s).toBeCloseTo(0.6, 9);
    expect(decide(s)).toBe("review");
  });

  it("venue aliases count as the same venue in the score", () => {
    const a = subj({ venueName: "Mahalaxmi Racecourse" });
    const b = subj({ venueName: "Mahalakshmi Race Course" });
    expect(duplicateScore(a, b)).toBeCloseTo(1, 9);
  });
});

describe("QA findDuplicate", () => {
  it("returns new with null candidate when there are none", () => {
    const r = findDuplicate(subj(), []);
    expect(r.decision).toBe("new");
    expect(r.candidate).toBeNull();
  });

  it("ignores an identical candidate outside the block", () => {
    const far = { ...subj({ startsAt: new Date("2026-12-05T12:00:00Z") }), id: "far" };
    const other = { ...subj({ city: "Pune" }), id: "pune" };
    expect(findDuplicate(subj(), [far, other]).decision).toBe("new");
  });

  it("picks the best-scoring candidate", () => {
    const weak = { ...subj({ artistKeys: ["x"] }), id: "weak" };
    const strong = { ...subj(), id: "strong" };
    const r = findDuplicate(subj(), [weak, strong]);
    expect(r.decision).toBe("merge");
    expect(r.candidate?.id).toBe("strong");
  });
});

describe("QA dedupeKey (title|YYYY-MM-DD UTC|city)", () => {
  const t = new Date("2026-12-01T12:00:00Z");
  it("is stable under title case/punctuation/year and city aliases", () => {
    const k = dedupeKey({ title: "Lollapalooza India", startsAt: t, city: "Mumbai" });
    expect(dedupeKey({ title: "LOLLAPALOOZA India 2026!", startsAt: t, city: "Bombay" })).toBe(k);
  });
  it("uses the UTC date (IST 01:00 on 2 Dec is 1 Dec UTC)", () => {
    const a = dedupeKey({
      title: "X Fest",
      startsAt: new Date("2026-12-02T01:00:00+05:30"),
      city: "Mumbai",
    });
    const b = dedupeKey({
      title: "X Fest",
      startsAt: new Date("2026-12-01T03:00:00Z"),
      city: "Mumbai",
    });
    expect(a).toBe(b);
    expect(a).toContain("2026-12-01");
  });
  it("differs by date and by city", () => {
    const k = dedupeKey({ title: "X Fest", startsAt: t, city: "Mumbai" });
    expect(
      dedupeKey({ title: "X Fest", startsAt: new Date(t.getTime() + 24 * H), city: "Mumbai" }),
    ).not.toBe(k);
    expect(dedupeKey({ title: "X Fest", startsAt: t, city: "Pune" })).not.toBe(k);
  });
});

describe("QA source precedence (admin > jambase > ticketmaster > user_submission, D-026)", () => {
  // D-053 (Lead, spec change): new collector sources slot in between ticketmaster and user_submission.
  // D-073 (Lead, spec change): artist_site and highape after teaminnovation; gig_web before web.
  it("SOURCE_PRECEDENCE order", () => {
    expect([...SOURCE_PRECEDENCE]).toEqual([
      "admin",
      "jambase",
      "ticketmaster",
      "sunburn",
      "teaminnovation",
      "artist_site",
      "highape",
      "wikipedia",
      "rollingstone",
      "pollstar",
      "gig_web",
      "web",
      "user_submission",
    ]);
  });

  it("every event source has a precedence (none can outrank admin by omission)", () => {
    for (const s of EVENT_SOURCES) expect(SOURCE_PRECEDENCE).toContain(s);
  });

  it.each([
    ["ticketmaster", ["admin"], false],
    ["jambase", ["admin"], false],
    ["user_submission", ["admin"], false],
    ["ticketmaster", ["ticketmaster", "admin"], false],
    ["admin", ["admin"], true],
    ["admin", ["ticketmaster"], true],
    ["jambase", ["ticketmaster"], true],
    ["user_submission", ["ticketmaster"], false],
    ["ticketmaster", ["ticketmaster"], true],
    ["ticketmaster", [], true],
  ] as const)("mayOverwrite(%s, %j) = %s", (incoming, existing, want) => {
    expect(mayOverwrite(incoming, existing)).toBe(want);
  });

  it("a lower source never overwrites admin values, only fills nulls", () => {
    const existing = {
      title: "Admin Title",
      genre: null as string | null,
      imageUrl: "a.png" as string | null,
    };
    const merged = mergeEventFields(
      existing,
      { title: "TM Title", genre: "Rock", imageUrl: null },
      mayOverwrite("ticketmaster", ["admin", "ticketmaster"]),
    );
    expect(merged).toEqual({ title: "Admin Title", genre: "Rock", imageUrl: "a.png" });
  });

  it("undefined never changes a field; null clears only when allowed", () => {
    const existing = { title: "T", genre: "Pop" as string | null };
    expect(mergeEventFields(existing, { title: undefined, genre: null }, true)).toEqual({
      title: "T",
      genre: null,
    });
    expect(mergeEventFields(existing, { genre: undefined }, true)).toEqual(existing);
  });

  it("does not mutate its inputs", () => {
    const existing = { title: "T", genre: null as string | null };
    const incoming = { title: "U", genre: "Rock" };
    mergeEventFields(existing, incoming, true);
    expect(existing).toEqual({ title: "T", genre: null });
  });
});

const e = (
  name: string,
  billingRank: number,
  tier: RawLineupEntry["tier"] = "support",
): RawLineupEntry => ({
  name,
  billingRank,
  tier,
});

describe("QA buildLineup", () => {
  it("splits 'A b2b B' into two artists with the credit's tier, adjacent", () => {
    const l = buildLineup([
      e("Headliner", 1, "headliner"),
      e("Nucleya b2b Ritviz", 2, "sub"),
      e("Last", 3),
    ]);
    expect(l.map((x) => x.name)).toEqual(["Headliner", "Nucleya", "Ritviz", "Last"]);
    expect(l[1]?.tier).toBe("sub");
    expect(l[2]?.tier).toBe("sub");
  });

  it("ranks are 1..n unique without gaps, in billing order", () => {
    const l = buildLineup([e("C", 30), e("A", 1, "headliner"), e("B", 7, "sub")]);
    expect(l.map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(l.map((x) => x.billingRank)).toEqual([1, 2, 3]);
  });

  it("duplicates (incl. case/diacritic variants) collapse to their highest billing", () => {
    const l = buildLineup([
      e("Beyoncé", 1, "headliner"),
      e("Opener", 2, "sub"),
      e("BEYONCE", 3, "support"),
      e("opener", 4, "mid"),
    ]);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ billingRank: 1, tier: "headliner" });
    expect(l[1]).toMatchObject({ name: "Opener", billingRank: 2, tier: "sub" });
  });

  it("a duplicate inside a b2b credit keeps the higher billing", () => {
    const l = buildLineup([e("A b2b B", 2, "sub"), e("B", 1, "headliner")]);
    const b = l.find((x) => x.normalizedName === l.find((y) => y.name === "B")?.normalizedName);
    expect(b).toMatchObject({ billingRank: 1, tier: "headliner" });
    expect(l.map((x) => x.billingRank)).toEqual([1, 2]);
  });

  it("empty lineup → empty", () => {
    expect(buildLineup([])).toEqual([]);
  });
});

describe("QA lineupHash", () => {
  const L = [
    { name: "Nucleya", tier: "headliner" as const },
    { name: "Ritviz", tier: "sub" as const },
  ];
  it("is independent of object key order", () => {
    const swapped = [
      { tier: "headliner" as const, name: "Nucleya" },
      { tier: "sub" as const, name: "Ritviz" },
    ];
    expect(lineupHash(swapped)).toBe(lineupHash(L));
  });
  it("ignores extra properties (e.g. billingRank)", () => {
    expect(lineupHash(L.map((x, i) => ({ ...x, billingRank: i + 1, stage: "Main" })))).toBe(
      lineupHash(L),
    );
  });
  it("changes when order changes or a tier changes", () => {
    expect(lineupHash([L[1]!, L[0]!])).not.toBe(lineupHash(L));
    expect(lineupHash([L[0]!, { name: "Ritviz", tier: "mid" }])).not.toBe(lineupHash(L));
  });
  it("is the same for case/diacritic variants of a name", () => {
    expect(lineupHash([{ name: "Beyoncé", tier: "headliner" }])).toBe(
      lineupHash([{ name: "BEYONCE", tier: "headliner" }]),
    );
  });
  it("empty lineup has a stable hash distinct from a non-empty one", () => {
    expect(lineupHash([])).toBe(lineupHash([]));
    expect(lineupHash([])).not.toBe(lineupHash(L));
  });
});

describe("QA tierFromAttractionOrder (D-027)", () => {
  const tiers = (n: number) => Array.from({ length: n }, (_, i) => tierFromAttractionOrder(i, n));
  it("1 act", () => expect(tiers(1)).toEqual(["headliner"]));
  it("3 acts", () => expect(tiers(3)).toEqual(["headliner", "support", "support"]));
  it("4 acts", () => expect(tiers(4)).toEqual(["headliner", "sub", "sub", "mid"]));
  it("10 acts", () =>
    expect(tiers(10)).toEqual([
      "headliner",
      "sub",
      "sub",
      "mid",
      "mid",
      "mid",
      "mid",
      "mid",
      "mid",
      "mid",
    ]));
  it("11 acts", () => expect(tiers(11).slice(9)).toEqual(["mid", "support"]));
});

describe("QA RawEventSchema", () => {
  const valid = {
    source: "ticketmaster",
    externalId: "tm-1",
    title: "X",
    type: "concert",
    startsAt: new Date("2026-12-01T12:00:00Z"),
    venue: { name: "NSCI Dome", city: "Mumbai", country: "in" },
    lineup: [{ name: "A", tier: "headliner", billingRank: 1 }],
    raw: {},
  };
  it("accepts a valid event and uppercases the country", () => {
    const r = RawEventSchema.parse(valid);
    expect(r.venue.country).toBe("IN");
  });
  it("lineup max 300", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `A${i}`, tier: "support", billingRank: i + 1 }));
    expect(RawEventSchema.safeParse({ ...valid, lineup: mk(300) }).success).toBe(true);
    expect(RawEventSchema.safeParse({ ...valid, lineup: mk(301) }).success).toBe(false);
  });
  it.each([
    ["billingRank 0", { lineup: [{ name: "A", tier: "headliner", billingRank: 0 }] }],
    ["bad tier", { lineup: [{ name: "A", tier: "opener", billingRank: 1 }] }],
    ["blank title", { title: "   " }],
    ["bad country", { venue: { name: "V", city: "C", country: "IND" } }],
    ["invalid date", { startsAt: new Date("nope") }],
    // Regression QA-E-1 (fixed): javascript: url must fail RawEventSchema (ENGINEERING §7)
    ["javascript: url", { url: "javascript:alert(1)" }],
    // Regression QA-E-1 (fixed): data: imageUrl must fail too
    ["data: imageUrl", { imageUrl: "data:text/html,<script>alert(1)</script>" }],
  ])("rejects %s", (_n, patch) => {
    expect(RawEventSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

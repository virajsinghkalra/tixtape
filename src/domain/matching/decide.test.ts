import { describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import {
  DEFAULT_MATCH_POLICY,
  decideMatch,
  matchArtist,
  needsSongOwnershipCheck,
  wantsEvidence,
} from "./decide";
import {
  applySongOwnership,
  rankCandidates,
  type ArtistCandidate,
  type ScoredCandidate,
} from "./score";

const scored = (id: string, score: number): ScoredCandidate => ({
  candidate: { id: asSpotifyArtistId(id), name: id, rank: 0, imageUrl: null, genres: [] },
  score,
  breakdown: {
    nameMatchKind: "none",
    nameMatch: 0,
    rank: 0,
    image: 0,
    genre: 0,
    externalId: 0,
    songOwnership: 0,
  },
});

describe("decideMatch", () => {
  it.each([
    ["Prateek Kuhad", [75], "auto", "confident"],
    ["Prateek Kuhad", [70, 55], "auto", "confident"],
    ["Prateek Kuhad", [75, 23.5], "auto", "confident"],
    ["Prateek Kuhad", [69.5, 10], "needs_review", "low_score"],
    ["Prateek Kuhad", [70, 55.5], "needs_review", "small_lead"],
    ["Prateek Kuhad", [75, 75], "needs_review", "small_lead"],
    ["Prateek Kuhad", [], "not_found", "no_candidates"],
    // Forced review, however confident the score
    ["KK", [100], "needs_review", "ambiguous_name"],
    ["MØ", [100], "needs_review", "ambiguous_name"],
    ["Tom", [100], "needs_review", "ambiguous_name"],
    ["D.O.C", [100], "needs_review", "ambiguous_name"],
    ["DIVINE", [100], "needs_review", "ambiguous_name"],
    ["Anirudh (Live)", [100], "needs_review", "ambiguous_name"],
    ["DJ Tom", [100], "needs_review", "ambiguous_name"],
    ["Ritviz", [100], "auto", "confident"],
    ["KK", [], "not_found", "no_candidates"],
  ] as const)("%j with scores %j → %s (%s)", (name, scores, status, reason) => {
    const ranked = scores.map((s, i) => scored(`sp${i}`, s));
    const decision = decideMatch(name, ranked);
    expect(decision.status).toBe(status);
    expect(decision.reason).toBe(reason);
    expect(decision.best).toBe(ranked[0] ?? null);
    expect(decision.candidates).toEqual(ranked);
  });

  it("uses a custom policy", () => {
    const policy = {
      ...DEFAULT_MATCH_POLICY,
      autoAcceptScore: 80,
      shortNameMaxLength: 1,
      ambiguousNames: ["Ritviz"],
    };
    expect(decideMatch("KK", [scored("a", 90)], policy).status).toBe("auto");
    expect(decideMatch("KK", [scored("a", 75)], policy).reason).toBe("low_score");
    expect(decideMatch("ritviz", [scored("a", 90)], policy).reason).toBe("ambiguous_name");
  });
});

describe("matchArtist (LLD §6 end to end)", () => {
  const c = (id: string, name: string, rank: number, imageUrl: string | null = "img") =>
    ({ id: asSpotifyArtistId(id), name, rank, imageUrl, genres: [] }) as ArtistCandidate;

  it.each([
    [
      "auto-accepts a clear exact match",
      "Prateek Kuhad",
      [c("a", "Prateek Kuhad", 0), c("b", "Prateek Kuhad Fans", 1)],
      "auto",
      "a",
    ],
    [
      "reviews two exact-name artists",
      "Seedhe Maut",
      [c("a", "Seedhe Maut", 0), c("b", "Seedhe Maut", 1)],
      "needs_review",
      "a",
    ],
    ["reviews a diacritics-only match", "Beyonce", [c("a", "Beyoncé", 0)], "needs_review", "a"],
    ["reviews a DJ-removed match", "Snake", [c("a", "DJ Snake", 0)], "needs_review", "a"],
    [
      "prefers the exact name over a better-ranked partial",
      "Anuv Jain",
      [c("x", "Anuv Jain Covers", 0), c("a", "Anuv Jain", 1)],
      "auto",
      "a",
    ],
    ["reports not found with no candidates", "When Chai Met Toast", [], "not_found", null],
  ] as const)("%s", (_label, name, candidates, status, bestId) => {
    const decision = matchArtist(name, candidates);
    expect(decision.status).toBe(status);
    expect(decision.best?.candidate.id ?? null).toBe(bestId);
  });

  // D-039: real Spotify has same-name stub profiles without images.
  it.each([
    ["top has an image, duplicate has none", "img", null, "auto", "confident", 85, 63.5],
    ["both have images", "img", "img", "needs_review", "small_lead", 85, 83.5],
    ["neither has an image", null, null, "needs_review", "low_score", 65, 63.5],
  ] as const)(
    "two exact-name Prateek Kuhads, %s → %s",
    (_label, topImage, otherImage, status, reason, topScore, otherScore) => {
      const decision = matchArtist("Prateek Kuhad", [
        c("real", "Prateek Kuhad", 0, topImage),
        c("stub", "Prateek Kuhad", 1, otherImage),
      ]);
      expect(decision).toMatchObject({ status, reason });
      expect(decision.best?.candidate.id).toBe("real");
      expect(decision.candidates.map((x) => x.score)).toEqual([topScore, otherScore]);
    },
  );

  it("needs more than a genre bonus to break a tie; an external-ID link does", () => {
    const candidates = [
      { ...c("a", "Ritviz", 0), genres: ["indian edm"] },
      { ...c("b", "Ritviz", 1), genres: ["bollywood"] },
    ];
    expect(matchArtist("Ritviz", candidates).status).toBe("needs_review");
    expect(matchArtist("Ritviz", candidates, { eventGenres: ["edm"] }).status).toBe("needs_review");
    const external = { externalSpotifyIds: new Set([asSpotifyArtistId("a")]) };
    expect(matchArtist("Ritviz", candidates, external).status).toBe("auto");
  });
});

describe("needsSongOwnershipCheck (D-041)", () => {
  it.each([
    ["near-tie above the accept score", "KATSEYE", [85, 83.5], true],
    ["near-tie the bonus can lift to 70", "KATSEYE", [50, 45], true],
    ["near-tie the bonus can't lift to 70", "KATSEYE", [49.5, 45], false],
    ["lead exactly at the margin", "KATSEYE", [85, 70], false],
    ["single candidate", "KATSEYE", [85], false],
    ["no candidates", "KATSEYE", [], false],
    ["name forced to review anyway", "KK", [85, 83.5], false],
    ["ambiguous common name", "DIVINE", [85, 83.5], false],
  ] as const)("%s → %s", (_label, name, scores, expected) => {
    const ranked = scores.map((s, i) => scored(`sp${i}`, s));
    expect(needsSongOwnershipCheck(name, ranked)).toBe(expected);
  });
});

describe("song ownership decides same-name duplicates (D-041 real cases)", () => {
  const dupes = (name: string, dupeRank: number): ArtistCandidate[] => [
    { id: asSpotifyArtistId("real"), name, rank: 0, imageUrl: "img", genres: [] },
    { id: asSpotifyArtistId("dupe"), name, rank: dupeRank, imageUrl: "img", genres: [] },
  ];
  const credit = (...ids: string[]) => ids.map((id) => ({ artistIds: [asSpotifyArtistId(id)] }));

  it.each([
    ["KATSEYE", 1, credit("real", "real", "dupe"), "auto", "real"],
    ["Ritviz", 1, credit("real"), "auto", "real"],
    ["Diljit Dosanjh", 2, credit("real", "real"), "auto", "real"],
    ["KATSEYE", 1, credit("real", "dupe"), "needs_review", "real"],
    ["Ritviz", 1, [], "needs_review", "real"],
    ["Seedhe Maut", 1, credit("dupe", "dupe"), "auto", "dupe"],
  ] as const)("%s (dupe at rank %d), tracks %j → %s", (name, dupeRank, tracks, status, bestId) => {
    const ranked = rankCandidates(name, dupes(name, dupeRank));
    expect(needsSongOwnershipCheck(name, ranked)).toBe(true);
    const decision = decideMatch(name, applySongOwnership(ranked, tracks));
    expect(decision.status).toBe(status);
    expect(decision.best?.candidate.id).toBe(bestId);
  });
});

describe("decideMatch with D-066 evidence", () => {
  const withEvidence = (
    id: string,
    score: number,
    over: Partial<ScoredCandidate["breakdown"]>,
    ownedTracks?: number,
  ): ScoredCandidate => {
    const base = scored(id, score);
    return {
      ...base,
      breakdown: { ...base.breakdown, ...over },
      ...(ownedTracks === undefined ? {} : { evidence: { ownedTracks } }),
    };
  };

  it.each([
    // Variant names need strong evidence
    [
      "Dhyan Live",
      [withEvidence("a", 75, { nameMatchKind: "variant" })],
      "needs_review",
      "needs_evidence",
    ],
    [
      "Dhyan Live",
      [withEvidence("a", 105, { nameMatchKind: "variant", webLink: 30 })],
      "auto",
      "confident",
    ],
    [
      "Dhyan Live",
      [withEvidence("a", 95, { nameMatchKind: "variant", externalId: 20 })],
      "auto",
      "confident",
    ],
    [
      "Dhyan Live",
      [withEvidence("a", 95, { nameMatchKind: "variant", songOwnership: 20 }, 3)],
      "auto",
      "confident",
    ],
    [
      "Dhyan Live",
      [withEvidence("a", 95, { nameMatchKind: "variant", songOwnership: 20 }, 1)],
      "needs_review",
      "needs_evidence",
    ],
    [
      "Dhyan Live",
      [withEvidence("a", 95, { nameMatchKind: "variant", active: 10 })],
      "needs_review",
      "needs_evidence",
    ],
    [
      "Dhyan Live",
      [
        withEvidence("a", 105, { nameMatchKind: "variant", webLink: 30 }),
        withEvidence("b", 95, { nameMatchKind: "variant" }),
      ],
      "needs_review",
      "small_lead",
    ],
    // Collab parts are a different act
    [
      "PRFCT & DARK",
      [withEvidence("a", 120, { nameMatchKind: "collab_part", webLink: 30 })],
      "needs_review",
      "collab",
    ],
    // Short or common names: only independent evidence lifts them
    [
      "DIVINE",
      [withEvidence("a", 85, { nameMatchKind: "exact" })],
      "needs_review",
      "ambiguous_name",
    ],
    [
      "DIVINE",
      [withEvidence("a", 115, { nameMatchKind: "exact", webLink: 30 })],
      "auto",
      "corroborated",
    ],
    // Four letters and not on the list: the normal exact-name rule
    ["Lijo", [withEvidence("a", 85, { nameMatchKind: "exact" })], "auto", "confident"],
    // Named common names on the policy list (D-066)
    [
      "Felix",
      [withEvidence("a", 85, { nameMatchKind: "exact" })],
      "needs_review",
      "ambiguous_name",
    ],
    [
      "Sazi",
      [withEvidence("a", 115, { nameMatchKind: "exact", webLink: 30 })],
      "auto",
      "corroborated",
    ],
    [
      "HRX",
      [withEvidence("a", 115, { nameMatchKind: "exact", webLink: 30 })],
      "auto",
      "corroborated",
    ],
    [
      "KK",
      [withEvidence("a", 105, { nameMatchKind: "exact", externalId: 20 })],
      "auto",
      "corroborated",
    ],
    [
      "HRX",
      [withEvidence("a", 105, { nameMatchKind: "exact", songOwnership: 20 }, 5)],
      "needs_review",
      "ambiguous_name",
    ],
    [
      "HRX",
      [withEvidence("a", 115, { nameMatchKind: "exact", webLink: 30 }), withEvidence("b", 110, {})],
      "needs_review",
      "ambiguous_name",
    ],
    [
      "HRX",
      [withEvidence("a", 65, { nameMatchKind: "exact", webLink: 30 })],
      "needs_review",
      "ambiguous_name",
    ],
    // Exact names keep the D-009 rule
    [
      "MXRCI (Live Set)",
      [
        withEvidence("a", 115, { nameMatchKind: "exact", webLink: 30 }),
        withEvidence("b", 85, { nameMatchKind: "exact" }),
      ],
      "auto",
      "confident",
    ],
  ] as const)("%j → %s (%s)", (name, ranked, status, reason) => {
    const decision = decideMatch(name, [...ranked]);
    expect(decision).toMatchObject({ status, reason });
  });
});

describe("wantsEvidence (D-066)", () => {
  const decision = (
    status: "auto" | "needs_review" | "not_found",
    kind: ScoredCandidate["breakdown"]["nameMatchKind"] | null,
  ) => ({
    status,
    reason: "low_score" as const,
    best:
      kind === null
        ? null
        : { ...scored("a", 60), breakdown: { ...scored("a", 60).breakdown, nameMatchKind: kind } },
    candidates: [],
  });
  it.each([
    ["needs_review", "exact", true],
    ["needs_review", "variant", true],
    ["needs_review", "dj_removed", true],
    ["needs_review", "collab_part", false],
    ["needs_review", "none", false],
    ["auto", "exact", false],
    ["not_found", null, false],
  ] as const)("%s with a %s leader → %s", (status, kind, expected) => {
    expect(wantsEvidence(decision(status, kind))).toBe(expected);
  });
});

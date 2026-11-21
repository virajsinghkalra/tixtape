import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_POLICY,
  decideMatch,
  matchArtist,
  type MatchPolicy,
} from "@/domain/matching/decide";
import {
  rankCandidates,
  scoreCandidate,
  type ArtistCandidate,
  type ScoredCandidate,
} from "@/domain/matching/score";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { cand } from "./fakes";

const c = (name: string, rank: number, over: Partial<ArtistCandidate> = {}): ArtistCandidate =>
  cand(name, rank, { ...over, genres: over.genres ? [...over.genres] : [] });

describe("QA scoreCandidate (LLD §6.5)", () => {
  it("exact normalized match gives +50", () => {
    const s = scoreCandidate("Daft Punk", c("Daft Punk", 20, { imageUrl: null }));
    expect(s.breakdown.nameMatchKind).toBe("exact");
    expect(s.breakdown.nameMatch).toBe(50);
    expect(s.score).toBe(50);
  });

  it("case/whitespace differences are still exact", () => {
    const s = scoreCandidate("  daft   PUNK ", c("Daft Punk", 20, { imageUrl: null }));
    expect(s.breakdown.nameMatch).toBe(50);
  });

  it("diacritics-only difference gives +30", () => {
    const s = scoreCandidate("Beyonce", c("Beyoncé", 20, { imageUrl: null }));
    expect(s.breakdown.nameMatchKind).toBe("diacritics_only");
    expect(s.breakdown.nameMatch).toBe(30);
    expect(s.score).toBe(30);
  });

  it("match after removing DJ gives +25", () => {
    const s = scoreCandidate("DJ Shadow Clone", c("Shadow Clone", 20, { imageUrl: null }));
    expect(s.breakdown.nameMatchKind).toBe("dj_removed");
    expect(s.breakdown.nameMatch).toBe(25);
  });

  it("unrelated name gives 0", () => {
    const s = scoreCandidate("Daft Punk", c("Justice", 20, { imageUrl: null }));
    expect(s.breakdown.nameMatchKind).toBe("none");
    expect(s.score).toBe(0);
  });

  it.each([
    [0, 15],
    [1, 13.5],
    [4, 9],
    [9, 1.5],
    [10, 0],
    [11, 0],
    [25, 0],
    [1000, 0],
  ])("rank %i gives rank bonus %d (never negative)", (rank, bonus) => {
    const s = scoreCandidate("Zzz Nomatch", c("Other", rank, { imageUrl: null }));
    expect(s.breakdown.rank).toBeCloseTo(bonus, 10);
    expect(s.score).toBeGreaterThanOrEqual(0);
  });

  // D-039 (Lead, spec change): image weight raised from +10 to +20.
  it("image gives +20, null image 0", () => {
    expect(scoreCandidate("A A", c("B", 20)).breakdown.image).toBe(20);
    expect(scoreCandidate("A A", c("B", 20, { imageUrl: null })).breakdown.image).toBe(0);
  });

  it("genre +10 only when both sides have genres and they overlap", () => {
    const withG = c("B", 20, { imageUrl: null, genres: ["techno", "house"] });
    const noG = c("B", 20, { imageUrl: null, genres: [] });
    expect(scoreCandidate("A A", withG, { eventGenres: ["house"] }).breakdown.genre).toBe(10);
    expect(scoreCandidate("A A", withG, { eventGenres: ["jazz"] }).breakdown.genre).toBe(0);
    expect(scoreCandidate("A A", withG, { eventGenres: [] }).breakdown.genre).toBe(0);
    expect(scoreCandidate("A A", withG).breakdown.genre).toBe(0);
    expect(scoreCandidate("A A", noG, { eventGenres: ["house"] }).breakdown.genre).toBe(0);
    expect(scoreCandidate("A A", noG, { eventGenres: [] }).breakdown.genre).toBe(0);
  });

  it("genre overlap counts once even with multiple overlaps", () => {
    const g = c("B", 20, { imageUrl: null, genres: ["a", "b", "c"] });
    expect(scoreCandidate("A A", g, { eventGenres: ["a", "b", "c"] }).breakdown.genre).toBe(10);
  });

  it("external ID agreement gives +20 only for the linked id", () => {
    const x = c("B", 20, { imageUrl: null });
    expect(
      scoreCandidate("A A", x, { externalSpotifyIds: new Set([x.id]) }).breakdown.externalId,
    ).toBe(20);
    expect(
      scoreCandidate("A A", x, {
        externalSpotifyIds: new Set([asSpotifyArtistId("0000000000000000000000")]),
      }).breakdown.externalId,
    ).toBe(0);
  });

  it("score equals the sum of the breakdown", () => {
    const x = c("Daft Punk", 2, { genres: ["house"] });
    const s = scoreCandidate("Daft Punk", x, {
      eventGenres: ["house"],
      externalSpotifyIds: new Set([x.id]),
    });
    const b = s.breakdown;
    expect(s.score).toBeCloseTo(b.nameMatch + b.rank + b.image + b.genre + b.externalId, 10);
    expect(s.score).toBeCloseTo(50 + 12 + 20 + 10 + 20, 10); // D-039: image +20
  });

  it("does not mutate the input candidate", () => {
    const x = c("Daft Punk", 0, { genres: ["house"] });
    const copy = structuredClone(x);
    scoreCandidate("Daft Punk", x, { eventGenres: ["house"] });
    expect(x).toEqual(copy);
  });
});

describe("QA rankCandidates", () => {
  it("sorts best first and is deterministic under input permutation (ties)", () => {
    const list = [
      c("Other A", 3, { id: asSpotifyArtistId("aaaaaaaaaaaaaaaaaaaaaa"), imageUrl: null }),
      c("Other B", 3, { id: asSpotifyArtistId("bbbbbbbbbbbbbbbbbbbbbb"), imageUrl: null }),
      c("Daft Punk", 5),
      c("Other C", 3, { id: asSpotifyArtistId("cccccccccccccccccccccc"), imageUrl: null }),
    ];
    const a = rankCandidates("Daft Punk", list).map((s) => s.candidate.id);
    const b = rankCandidates("Daft Punk", [...list].reverse()).map((s) => s.candidate.id);
    const d = rankCandidates("Daft Punk", [list[1]!, list[3]!, list[0]!, list[2]!]).map(
      (s) => s.candidate.id,
    );
    expect(a[0]).toBe(list[2]!.id);
    expect(b).toEqual(a);
    expect(d).toEqual(a);
  });

  it("returns [] for no candidates", () => {
    expect(rankCandidates("Daft Punk", [])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const list = [c("X", 5), c("Daft Punk", 1)];
    const before = list.map((x) => x.id);
    rankCandidates("Daft Punk", list);
    expect(list.map((x) => x.id)).toEqual(before);
  });
});

function scored(score: number, name = "Cand"): ScoredCandidate {
  return {
    candidate: c(name + score, 0),
    score,
    breakdown: {
      nameMatchKind: "none",
      nameMatch: 0,
      rank: 0,
      image: 0,
      genre: 0,
      externalId: 0,
      songOwnership: 0,
    }, // D-041
  };
}

describe("QA decideMatch (LLD §6.6, D-009)", () => {
  const name = "Long Enough Artist";

  it.each([
    [[70, 55], "auto"],
    [[70], "auto"],
    [[100, 85], "auto"],
    [[69.9, 0], "needs_review"],
    [[69, 0], "needs_review"],
    [[70, 55.1], "needs_review"],
    [[70, 56], "needs_review"],
    [[90, 90], "needs_review"],
    [[200, 186], "needs_review"],
  ] as const)("scores %j -> %s", (scores, status) => {
    const d = decideMatch(
      name,
      scores.map((s) => scored(s)),
    );
    expect(d.status).toBe(status);
  });

  it("returns auto with the top candidate as best", () => {
    const top = scored(95);
    const d = decideMatch(name, [top, scored(10)]);
    expect(d.best?.candidate.id).toBe(top.candidate.id);
    expect(d.reason).toBe("confident");
  });

  it("reasons distinguish low score and small lead", () => {
    expect(decideMatch(name, [scored(60)]).reason).toBe("low_score");
    expect(decideMatch(name, [scored(80), scored(70)]).reason).toBe("small_lead");
  });

  it("no candidates -> not_found", () => {
    const d = decideMatch(name, []);
    expect(d.status).toBe("not_found");
    expect(d.reason).toBe("no_candidates");
    expect(d.best).toBeNull();
    expect(d.candidates).toEqual([]);
  });

  it.each(["ABC", "a b c", "M.I.A", "  XX  ", "Z", "ＡＢＣ", "The ABC", "DJ Q"])(
    "short name %j (≤3 chars after normalization) always goes to review",
    (short) => {
      expect(decideMatch(short, [scored(150)]).status).toBe("needs_review");
      expect(decideMatch(short, [scored(150)]).reason).toBe("ambiguous_name");
    },
  );

  it("4-char name can auto-accept", () => {
    expect(decideMatch("Abcd", [scored(100)]).status).toBe("auto");
    expect(decideMatch("Bicep", [scored(100)]).status).toBe("auto");
  });

  it("default policy matches the LLD thresholds and has a common-words list", () => {
    expect(DEFAULT_MATCH_POLICY.autoAcceptScore).toBe(70);
    expect(DEFAULT_MATCH_POLICY.minLeadOverRunnerUp).toBe(15);
    expect(DEFAULT_MATCH_POLICY.shortNameMaxLength).toBe(3);
    expect(DEFAULT_MATCH_POLICY.ambiguousNames.length).toBeGreaterThan(0);
  });

  it("every default ambiguous name goes to review regardless of score or casing", () => {
    for (const w of DEFAULT_MATCH_POLICY.ambiguousNames) {
      expect(decideMatch(w, [scored(150)]).status, w).toBe("needs_review");
      expect(decideMatch(`  ${w.toUpperCase()} `, [scored(150)]).status, w).toBe("needs_review");
    }
  });

  it("custom ambiguous list is compared after normalization", () => {
    const policy: MatchPolicy = { ...DEFAULT_MATCH_POLICY, ambiguousNames: ["Anirudh"] };
    expect(decideMatch("ANIRUDH", [scored(150)], policy).status).toBe("needs_review");
    expect(decideMatch("Anirudh Ravichander", [scored(150)], policy).status).toBe("auto");
  });

  it("ambiguous name with no candidates is still not_found", () => {
    expect(decideMatch("ABC", []).status).toBe("not_found");
  });
});

describe("QA matchArtist end to end (domain)", () => {
  it("exact match at boundary 70 with runner-up 55 auto-accepts", () => {
    // D-039: image +20. 50 exact + 0 rank(10) + 20 image = 70
    const top = c("Daft Punk", 10);
    // 0 name + 15 rank(0) + 20 image + 20 external = 55
    const runner = c("Daft Punk Tribute", 0);
    const d = matchArtist("Daft Punk", [runner, top], {
      externalSpotifyIds: new Set([runner.id]),
    });
    expect(d.candidates.map((s) => s.score)).toEqual([70, 55]);
    expect(d.status).toBe("auto");
    expect(d.best?.candidate.id).toBe(top.id);
  });

  it("identical names (two different artists, same name) never auto-accept", () => {
    const a = c("Daft Punk", 0);
    const b = c("Daft Punk", 1);
    expect(matchArtist("Daft Punk", [a, b]).status).toBe("needs_review");
  });

  it("only candidate with unrelated name -> needs_review, not auto", () => {
    expect(matchArtist("Daft Punk", [c("Justice", 0)]).status).toBe("needs_review");
  });

  it("is deterministic across repeated runs", () => {
    const list = [c("Daft Punk", 0), c("Daft Punk", 1), c("Daft Punks", 2)];
    const r1 = matchArtist("Daft Punk", list);
    const r2 = matchArtist("Daft Punk", [...list].reverse());
    expect(r2.candidates.map((s) => s.candidate.id)).toEqual(
      r1.candidates.map((s) => s.candidate.id),
    );
  });
});

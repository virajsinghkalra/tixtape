import { describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import {
  applyActivity,
  applySongOwnership,
  applyWebLinks,
  rankCandidates,
  scoreCandidate,
  type ArtistCandidate,
} from "./score";
import { nameVariants } from "./variants";

const candidate = (over: Partial<ArtistCandidate> = {}): ArtistCandidate => ({
  id: asSpotifyArtistId("sp1"),
  name: "Ritviz",
  rank: 0,
  imageUrl: "https://i.scdn.co/image/x",
  genres: [],
  ...over,
});

describe("scoreCandidate name signal", () => {
  it.each([
    ["Ritviz", "Ritviz", "exact", 50],
    ["RITVIZ", "Ritviz", "exact", 50],
    ["Ritviz (Live)", "Ritviz", "exact", 50],
    ["The Local Train", "The Local Train", "exact", 50],
    ["Local Train", "The Local Train", "exact", 50],
    ["Dr. Dre", "Dr. Dre", "exact", 50],
    ["Beyoncé", "Beyoncé", "exact", 50],
    ["Beyonce", "Beyoncé", "diacritics_only", 30],
    ["Sigur Rós", "Sigur Ros", "diacritics_only", 30],
    ["DJ Snake", "DJ Snake", "exact", 50],
    ["Snake", "DJ Snake", "dj_removed", 25],
    ["DJ Nucleya", "Nucleya", "dj_removed", 25],
    ["DJ Beyoncé", "Beyonce", "dj_removed", 25],
    ["Ritviz", "Ritvik", "none", 0],
    ["Seedhe Maut", "Seedhe Maut Fan Club", "none", 0],
    ["दिव्य", "दिव्य", "exact", 50],
  ] as const)("%j vs %j → %s (+%d)", (lineup, name, kind, points) => {
    const { breakdown } = scoreCandidate(lineup, candidate({ name }));
    expect(breakdown.nameMatchKind).toBe(kind);
    expect(breakdown.nameMatch).toBe(points);
  });
});

describe("scoreCandidate other signals", () => {
  it.each([
    [0, 15],
    [1, 13.5],
    [4, 9],
    [9, 1.5],
    [10, 0],
    [12, 0],
  ])("rank %d → +%d", (rank, points) => {
    expect(scoreCandidate("Ritviz", candidate({ rank })).breakdown.rank).toBe(points);
  });

  it.each([
    ["https://img", 20],
    [null, 0],
    ["", 0],
  ])("image %j → +%d", (imageUrl, points) => {
    expect(scoreCandidate("Ritviz", candidate({ imageUrl })).breakdown.image).toBe(points);
  });

  it.each([
    [["hip hop"], ["desi hip hop"], 10],
    [["Desi Hip Hop"], ["desi hip hop"], 10],
    [["electronic"], ["indian indie"], 0],
    [[], ["desi hip hop"], 0],
    [["hip hop"], [], 0],
    [undefined, ["desi hip hop"], 0],
    [[" "], [" "], 0],
  ])("event genres %j, artist genres %j → +%d", (eventGenres, genres, points) => {
    const scored = scoreCandidate("Ritviz", candidate({ genres }), { eventGenres });
    expect(scored.breakdown.genre).toBe(points);
  });

  it("adds the external-ID bonus only for a linked candidate", () => {
    const linked = new Set([asSpotifyArtistId("sp1")]);
    const ctx = { externalSpotifyIds: linked };
    expect(scoreCandidate("Ritviz", candidate(), ctx).breakdown.externalId).toBe(20);
    const other = candidate({ id: asSpotifyArtistId("sp2") });
    expect(scoreCandidate("Ritviz", other, ctx).breakdown.externalId).toBe(0);
  });

  it("sums the breakdown into the score", () => {
    const scored = scoreCandidate("Ritviz", candidate({ rank: 1, genres: ["indian edm"] }), {
      eventGenres: ["edm"],
      externalSpotifyIds: new Set([asSpotifyArtistId("sp1")]),
    });
    expect(scored.score).toBe(50 + 13.5 + 20 + 10 + 20);
  });
});

describe("rankCandidates", () => {
  it("orders by score, then rank, then id", () => {
    const ranked = rankCandidates("Ritviz", [
      candidate({ id: asSpotifyArtistId("c"), name: "Other", rank: 0 }),
      candidate({ id: asSpotifyArtistId("b"), name: "Ritviz", rank: 2, imageUrl: null }),
      candidate({ id: asSpotifyArtistId("a"), name: "Ritviz", rank: 1 }),
      candidate({ id: asSpotifyArtistId("z"), name: "Nope", rank: 3, imageUrl: null }),
      candidate({ id: asSpotifyArtistId("y"), name: "Nope", rank: 3, imageUrl: null }),
    ]);
    expect(ranked.map((r) => r.candidate.id)).toEqual(["a", "b", "c", "y", "z"]);
  });

  it("returns an empty list for no candidates", () => {
    expect(rankCandidates("Ritviz", [])).toEqual([]);
  });
});

describe("applySongOwnership (D-041)", () => {
  // Two same-name profiles with images: 85 vs 83.5 before the bonus.
  const ranked = () =>
    rankCandidates("KATSEYE", [
      candidate({ id: asSpotifyArtistId("real"), name: "KATSEYE", rank: 0 }),
      candidate({ id: asSpotifyArtistId("dupe"), name: "Katseye", rank: 1 }),
    ]);
  const tracks = (...credits: string[][]) =>
    credits.map((ids) => ({ artistIds: ids.map(asSpotifyArtistId) }));

  it.each([
    ["the top candidate owns the most tracks", tracks(["real"], ["real"], ["dupe"]), "real", 105],
    [
      "a collaboration counts for every credited artist",
      tracks(["real", "dupe"], ["real"]),
      "real",
      105,
    ],
    ["the runner-up owns the most tracks", tracks(["dupe"], ["dupe"], ["real"]), "dupe", 103.5],
  ])("%s → %s gets +20", (_label, found, owner, ownerScore) => {
    const result = applySongOwnership(ranked(), found);
    expect(result[0]?.candidate.id).toBe(owner);
    expect(result[0]?.score).toBe(ownerScore);
    expect(result[0]?.breakdown.songOwnership).toBe(20);
    expect(result[1]?.breakdown.songOwnership).toBe(0);
  });

  it.each([
    ["a tie for the most", tracks(["real"], ["dupe"])],
    ["no tracks", tracks()],
    ["tracks by someone else", tracks(["other"], ["other"])],
  ])("gives nobody the bonus for %s", (_label, found) => {
    const result = applySongOwnership(ranked(), found);
    expect(result.map((r) => [r.candidate.id, r.score, r.breakdown.songOwnership])).toEqual([
      ["real", 85, 0],
      ["dupe", 83.5, 0],
    ]);
  });

  it("does not modify its input", () => {
    const before = ranked();
    const copy = structuredClone(before);
    applySongOwnership(before, tracks(["dupe"]));
    expect(before).toEqual(copy);
  });
});

describe("variant name matches (D-066)", () => {
  const variants = nameVariants("Dhyan Live");
  it.each([
    ["Dhyan Live", "exact", 50, "Dhyan Live"],
    ["Dhyan", "variant", 40, "Dhyan"],
    ["DJ Dhyan", "variant", 40, "Dhyan"],
    ["Dhyan Dinesh", "none", 0, undefined],
  ] as const)("%j → %s (+%d)", (name, kind, points, matchedName) => {
    const scored = scoreCandidate("Dhyan Live", candidate({ name }), { variants });
    expect(scored.breakdown.nameMatchKind).toBe(kind);
    expect(scored.breakdown.nameMatch).toBe(points);
    expect(scored.evidence?.matchedName).toBe(matchedName);
  });

  it("marks a match on one side of a collaboration", () => {
    const ctx = { variants: nameVariants("PRFCT & DARK") };
    const scored = scoreCandidate("PRFCT & DARK", candidate({ name: "D.Ark" }), ctx);
    expect(scored.breakdown).toMatchObject({ nameMatchKind: "collab_part", nameMatch: 25 });
  });

  it("ignores variants without a context", () => {
    expect(scoreCandidate("Dhyan Live", candidate({ name: "Dhyan" })).breakdown.nameMatch).toBe(0);
  });
});

describe("applyWebLinks (D-066)", () => {
  const ranked = () =>
    rankCandidates("MXRCI", [
      candidate({ id: asSpotifyArtistId("dupe"), name: "Mxrci", rank: 0 }),
      candidate({ id: asSpotifyArtistId("real"), name: "Mxrci", rank: 2 }),
    ]);
  const hosts = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries).map(([id, h]) => [asSpotifyArtistId(id), h]));

  it.each([
    ["cited by 4 sites vs 1", { real: ["a", "b", "c", "d"], dupe: ["open.spotify.com"] }, "real"],
    ["cited by 2 sites, rival none", { real: ["a", "b"] }, "real"],
    ["cited by only 1 site", { real: ["a"] }, null],
    ["a tie", { real: ["a", "b"], dupe: ["c", "d"] }, null],
    ["no citations", {}, null],
  ])("%s → bonus to %s", (_label, entries, winner) => {
    const result = applyWebLinks(ranked(), hosts(entries));
    const linked = result.filter((r) => r.breakdown.webLink === 30).map((r) => r.candidate.id);
    expect(linked).toEqual(winner ? [winner] : []);
    if (winner) expect(result[0]?.candidate.id).toBe(winner);
    expect(result.find((r) => r.candidate.id === "real")?.evidence?.webHosts).toEqual(
      (entries as Record<string, string[]>).real ?? [],
    );
  });
});

describe("applyActivity (D-066)", () => {
  it.each([
    [2026, 10],
    [2024, 10],
    [2023, 0],
    [null, 0],
  ])("newest release %s in 2026 → +%d", (year, points) => {
    const ranked = rankCandidates("Ritviz", [candidate()]);
    const [result] = applyActivity(ranked, new Map([[asSpotifyArtistId("sp1"), year]]), 2026);
    expect(result?.breakdown.active).toBe(points);
    expect(result?.evidence?.newestReleaseYear).toBe(year);
  });

  it("leaves candidates without a lookup alone", () => {
    const [result] = applyActivity(rankCandidates("Ritviz", [candidate()]), new Map(), 2026);
    expect(result?.breakdown.active).toBe(0);
    expect(result?.evidence).not.toHaveProperty("newestReleaseYear");
  });
});

import { describe, expect, it } from "vitest";
import { blendScore, lastfmScore, setlistScore } from "./song-score";

describe("song scores (D-085)", () => {
  it.each([
    [1, 1],
    [26, 0.5],
    [50, 0.02],
    [80, 0],
    [null, 0],
  ])("Last.fm rank %s → %s", (rank, score) => {
    expect(lastfmScore(rank)).toBeCloseTo(score, 6);
  });

  it.each<[number, number, boolean, number]>([
    [10, 20, false, 0.5],
    [10, 20, true, 0.75],
    [20, 20, true, 1],
    [0, 20, true, 0],
    [3, 0, false, 0],
  ])("setlist %i of %i (tour %s) → %s", (plays, setlists, tour, score) => {
    expect(setlistScore(plays, setlists, tour)).toBeCloseTo(score, 6);
  });

  it("blends 60/40 when both providers know the artist", () => {
    expect(blendScore({ lastfm: 1, setlistfm: 0 }, ["lastfm", "setlistfm"])).toBeCloseTo(0.6, 6);
    expect(blendScore({ lastfm: 0, setlistfm: 1 }, ["lastfm", "setlistfm"])).toBeCloseTo(0.4, 6);
  });

  it("falls back to one provider when the other doesn't know the artist", () => {
    expect(blendScore({ lastfm: 0.8 }, ["lastfm"])).toBeCloseTo(0.8, 6);
    expect(blendScore({ setlistfm: 0.5 }, ["setlistfm"])).toBeCloseTo(0.5, 6);
    expect(blendScore({}, [])).toBe(0);
  });
});

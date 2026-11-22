import { describe, expect, it } from "vitest";
import { bumpTrend, decayedTrend, ENGAGEMENT_WEIGHTS, TREND_HALF_LIFE_MS } from "./trend";

const t0 = new Date("2026-11-01T00:00:00Z");
const after = (ms: number) => new Date(t0.getTime() + ms);

describe("trend score", () => {
  it.each([
    [0, 8],
    [TREND_HALF_LIFE_MS, 4],
    [2 * TREND_HALF_LIFE_MS, 2],
    [TREND_HALF_LIFE_MS / 2, 8 / Math.SQRT2],
    [-TREND_HALF_LIFE_MS, 8],
  ])("8 points after %i ms → %f", (age, expected) => {
    expect(decayedTrend(8, t0, after(age))).toBeCloseTo(expected, 6);
  });

  it("weights: view 1, search click 3, playlist open 5", () => {
    expect(ENGAGEMENT_WEIGHTS).toEqual({ view: 1, search_click: 3, playlist_open: 5, save: 2 });
  });

  it.each([
    ["view", 0, 1],
    ["search_click", 0, 3],
    ["playlist_open", TREND_HALF_LIFE_MS, 4 + 5],
  ] as const)("bump %s after %i ms on 8 points", (kind, age, expected) => {
    expect(bumpTrend(kind === "playlist_open" ? 8 : 0, t0, after(age), kind)).toBeCloseTo(
      expected,
      6,
    );
  });
});

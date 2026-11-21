import { describe, expect, it } from "vitest";
import { parsePreview, previewPending, type PlaylistPreview } from "./playlist-preview";

const home: PlaylistPreview = {
  songs: 256,
  minutes: 960,
  perTier: [
    { tier: "headliner", artists: 2, songs: 56, minutes: 210 },
    { tier: "sub", artists: 1, songs: 20, minutes: 75 },
    { tier: "mid", artists: 0, songs: 0, minutes: 0 },
    { tier: "support", artists: 9, songs: 180, minutes: 675 },
  ],
  showMinutes: 960,
  days: 2,
  unmatched: 2,
};

describe("parsePreview", () => {
  it("accepts the estimate JSON and rejects anything else", () => {
    expect(parsePreview(JSON.parse(JSON.stringify(home)))).toEqual(home);
    expect(parsePreview({ songs: "lots" })).toBeNull();
    expect(parsePreview(null)).toBeNull();
  });
});

describe("previewPending (never '0 songs · 0 min')", () => {
  const zero: PlaylistPreview = { ...home, songs: 0, minutes: 0, perTier: [], unmatched: 1 };
  it("is pending when no artist is matched, or the estimate is empty", () => {
    expect(previewPending(home, 0, 12)).toBe(true);
    expect(previewPending(null, 0, 1)).toBe(true);
    expect(previewPending(zero, 1, 1)).toBe(true);
    expect(previewPending({ ...home, minutes: 0.2 }, 10, 12)).toBe(true);
  });
  it("a partial match shows its real numbers; no lineup isn't pending", () => {
    expect(previewPending(home, 10, 12)).toBe(false);
    expect(previewPending(null, 3, 12)).toBe(false);
    expect(previewPending(null, 0, 0)).toBe(false);
  });
});

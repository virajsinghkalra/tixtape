import { describe, expect, it } from "vitest";
import {
  formatDuration,
  headline,
  parsePreview,
  readyLine,
  showLine,
  tierLines,
  unmatchedLine,
  type PlaylistPreview,
} from "./playlist-preview";

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

describe("preview copy (D-065)", () => {
  it("headline and show line: 256 songs · about 16 h · matches the show (2 days × 8 h)", () => {
    expect(headline(home)).toBe("256 songs · about 16 h");
    expect(showLine(home)).toBe("matches the show (2 days × 8 h)");
    expect(showLine({ ...home, days: 1, showMinutes: 180 })).toBe("matches the show (3 h)");
  });

  it("per tier, rounded songs each, skipping empty tiers", () => {
    expect(tierLines(home).map((t) => t.text)).toEqual([
      "Headliners: 2 artists · ~28 songs each",
      "Sub-headliner: ~20 songs",
      "Support: 9 artists · ~20 songs each",
    ]);
  });

  it("mentions artists not on Spotify yet only when there are some", () => {
    expect(unmatchedLine(home)).toBe("2 artists not on Spotify yet");
    expect(unmatchedLine({ ...home, unmatched: 1 })).toBe("1 artist not on Spotify yet");
    expect(unmatchedLine({ ...home, unmatched: 0 })).toBeNull();
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45 min"],
    [60, "1 h"],
    [158, "2 h 38 min"],
    [960, "16 h"],
  ])("%i → %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe("small lineups (no plural headliners, no breakdown for one artist)", () => {
  const solo: PlaylistPreview = {
    songs: 32,
    minutes: 120,
    perTier: [{ tier: "headliner", artists: 1, songs: 32, minutes: 120 }],
    showMinutes: 120,
    days: 1,
    unmatched: 0,
  };
  it("solo: ~32 songs · 2 h of Bhuwin, and no tier lines", () => {
    expect(headline(solo, "Bhuwin")).toBe("~32 songs · 2 h of Bhuwin");
    expect(tierLines(solo)).toEqual([]);
  });

  it("one artist in a tier is singular, with no 'each'", () => {
    const duo: PlaylistPreview = {
      ...solo,
      songs: 60,
      perTier: [
        { tier: "headliner", artists: 1, songs: 40, minutes: 150 },
        { tier: "support", artists: 1, songs: 20, minutes: 70 },
      ],
    };
    expect(tierLines(duo).map((t) => t.text)).toEqual([
      "Headliner: ~40 songs",
      "Support: ~20 songs",
    ]);
  });
});

describe("readyLine (D-080)", () => {
  const base = {
    songs: 256,
    minutes: 960,
    perTier: [],
    showMinutes: 960,
    days: 2,
    unmatched: 0,
  };
  it.each([
    [undefined, ""],
    [{ cachedArtists: 24, artists: 24, seconds: 5 }, "Ready in about 5 s"],
    [{ cachedArtists: 20, artists: 24, seconds: 14 }, "Ready in about 15 s"],
    [{ cachedArtists: 0, artists: 24, seconds: 117 }, "Takes about 2 min to make"],
  ])("%j → %s", (readiness, text) => {
    expect(readyLine({ ...base, readiness })).toBe(text);
  });
});

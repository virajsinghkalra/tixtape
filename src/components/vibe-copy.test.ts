import { describe, expect, it } from "vitest";
import { cookingLine, pick, shareCopy, tagline, vibeHeadline, vibeOf, VIBES } from "./vibe-copy";

describe("vibeOf", () => {
  it.each([
    ["edm", "concert", "edm"],
    ["edm, afro house", "concert", "edm"],
    ["punjabi sufi", "concert", "sufi"],
    ["sufi qawwali", "concert", "sufi"],
    ["punjabi", "concert", "punjabi"],
    ["bollywood", "concert", "bollywood"],
    ["malayalam filmi", "concert", "bollywood"],
    ["hip hop", "concert", "hiphop"],
    ["k-pop", "concert", "kpop"],
    ["alt rock", "concert", "rock"],
    ["indie", "concert", "indie"],
    ["world fusion", "concert", "fusion"],
    ["pop, r&b", "concert", "pop"],
    ["pop, rock, hip hop", "festival", "festival"],
    [null, "concert", "default"],
  ])("%s (%s) → %s", (genre, type, vibe) => {
    expect(vibeOf(genre, type)).toBe(vibe);
  });
});

describe("copy picks", () => {
  it("is stable per show and varies across shows", () => {
    expect(tagline("edm", "e1")).toBe(tagline("edm", "e1"));
    const lines = new Set(Array.from({ length: 40 }, (_, i) => tagline("edm", `event-${i}`)));
    expect(lines.size).toBeGreaterThan(1);
  });

  it("speaks English only and never says 'all night'", () => {
    const hinglish = /\b(gaane|gaana|dil se|sukoon|rooh|dhol|balle|bhangra|hai|sun|yaar)\b/iu;
    for (const vibe of VIBES) {
      for (let i = 0; i < 30; i++) {
        const seed = `s${i}`;
        const all = [
          tagline(vibe, seed),
          vibeHeadline(vibe, seed),
          cookingLine(vibe, seed),
          shareCopy(vibe, seed).title,
          shareCopy(vibe, seed).text,
        ];
        for (const line of all) {
          expect(line).not.toMatch(hinglish);
          expect(line).not.toMatch(/all night/iu);
        }
      }
    }
  });

  it("has every line for every vibe", () => {
    for (const vibe of VIBES) {
      expect(vibeHeadline(vibe, "a")).toBeTruthy();
      expect(cookingLine(vibe, "a")).toMatch(/👇$/u);
      const share = shareCopy(vibe, "a");
      expect(share.title.length).toBeLessThanOrEqual(30);
      expect(share.text).toBeTruthy();
    }
  });

  it("pick stays in range", () => {
    expect(pick(["a"], "anything")).toBe("a");
  });
});

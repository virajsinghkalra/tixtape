import { describe, expect, it } from "vitest";
import { cookingLine, pick, shareCopy, soloLine, vibeHeadline, vibeOf, VIBES } from "./vibe-copy";

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
    expect(soloLine("Garrix", "edm", "e1")).toBe(soloLine("Garrix", "edm", "e1"));
    const lines = new Set(
      Array.from({ length: 40 }, (_, i) => soloLine("Garrix", "edm", `event-${i}`)),
    );
    expect(lines.size).toBeGreaterThan(1);
    expect([...lines].every((l) => l.startsWith("Garrix, "))).toBe(true);
  });

  it("never says 'all night' for a show with a known vibe", () => {
    for (const vibe of VIBES.filter((v) => v !== "default")) {
      for (let i = 0; i < 20; i++) expect(soloLine("X", vibe, `s${i}`)).not.toMatch(/all night/u);
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

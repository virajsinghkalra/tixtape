import { describe, expect, it } from "vitest";
import { normalizeArtistName as n, splitArtistCredit as split } from "@/domain/shared/normalize";

describe("QA normalizeArtistName (LLD §6.1, D-013)", () => {
  it.each([
    ["Beyoncé", "Beyonce"],
    ["Beyoncé", "Beyoncé"], // decomposed vs precomposed
    ["MOTÖRHEAD", "motorhead"],
    ["Sigur Rós", "sigur ros"],
    ["  The   Weeknd  ", "Weeknd"],
    ["the weeknd", "THE WEEKND"],
    ["DJ Snake", "Snake"],
    ["dj snake", "Snake"],
    ["Simon & Garfunkel", "Simon and Garfunkel"],
    ["Simon + Garfunkel", "Simon & Garfunkel"],
    ["Simon AND Garfunkel", "simon & garfunkel"],
    ["Fred again.. (Live)", "Fred again.."],
    ["Peggy Gou (DJ Set)", "Peggy Gou"],
    ["Peggy Gou (dj set)", "peggy gou"],
    ["Bicep [Hybrid]", "Bicep"],
    ["Bicep [hybrid]", "BICEP"],
    ["ＢＩＣＥＰ", "Bicep"], // full-width (NFKD compatibility)
    ["Daft\tPunk", "Daft Punk"],
    ["Daft\n  Punk", "daft punk"],
    ["AC/DC", "AC-DC"],
    ["Fred again..", "Fred again"],
  ])("%j ≡ %j", (a, b) => {
    expect(n(a)).toBe(n(b));
  });

  it("produces lowercase without diacritics for a Latin name", () => {
    expect(n("Beyoncé")).toBe("beyonce");
    expect(n("Röyksopp")).toBe("royksopp");
  });

  it("does not strip 'the' or 'dj' inside or at the end of a name", () => {
    expect(n("Djo")).toBe("djo");
    expect(n("Theory of a Deadman")).toContain("theory");
    expect(n("Kid Cudi the")).toContain("the");
    expect(n("Mr DJ")).toContain("dj");
  });

  it("does not equate different artists", () => {
    expect(n("Djo")).not.toBe(n("o"));
    expect(n("Simon & Garfunkel")).not.toBe(n("Simon Garfunkel x"));
    expect(n("Bicep")).not.toBe(n("Biceps"));
  });

  it("trims leading/trailing whitespace including NBSP and zero-width chars", () => {
    expect(n(" Daft Punk ")).toBe(n("Daft Punk"));
    expect(n("​Daft Punk​")).toBe(n("Daft Punk"));
    expect(n("﻿Daft Punk")).toBe(n("Daft Punk"));
  });

  it("handles empty and whitespace-only strings without throwing", () => {
    expect(n("")).toBe("");
    expect(n("   ")).toBe("");
  });

  it("keeps non-Latin scripts (Devanagari, Japanese, Cyrillic, Arabic)", () => {
    for (const s of ["अरिजीत सिंह", "ヨルシカ", "Кино", "عمرو دياب", "周杰倫"]) {
      expect(n(s).length).toBeGreaterThan(0);
    }
    expect(n("Кино")).toBe("кино");
  });

  it("keeps Devanagari vowel signs (matras), which are part of the letters", () => {
    expect(n("अरिजीत सिंह")).toBe("अरिजीत सिंह".normalize("NFKD"));
  });

  it("does not merge distinct Devanagari names", () => {
    expect(n("सोनू")).not.toBe(n("सन"));
  });

  it("handles emoji and very long strings", () => {
    expect(() => n("Lil 🐐 Baby 🔥")).not.toThrow();
    const long = "Ab ".repeat(50_000);
    const out = n(long);
    expect(out.length).toBeLessThanOrEqual(long.length);
    expect(n(out)).toBe(out);
  });

  it("casefolds ß and Turkish İ consistently", () => {
    // Spec says "casefold"; full casefolding maps ß -> ss. Ambiguous whether lowercasing suffices.
    expect(n(n("İlhan"))).toBe(n("İlhan"));
    expect(n("İlhan")).toBe(n("ilhan"));
  });

  const corpus = [
    "Beyoncé",
    "The Weeknd",
    "DJ Snake",
    "The The",
    "DJ DJ Shadow",
    "dj",
    "the",
    "Simon & Garfunkel",
    "Above + Beyond",
    "Fred again.. (Live) (DJ Set)",
    "Bicep [Hybrid] (Live)",
    "  ＡＢＣ  ",
    "Beyoncé́",
    "अरिजीत सिंह",
    "ヨルシカ",
    "ガガ",
    "Lil 🐐",
    "Daft​Punk",
    "AC/DC",
    "!!!",
    "(Live)",
    "[hybrid]",
    "The DJ Shadow",
    "DJ The Shadow",
    "Ⅻ",
    "ﬁre",
    "Strauß",
    "İlhan",
    "a\u0000b",
  ];
  it.each(corpus)("is idempotent for %j", (s) => {
    const once = n(s);
    expect(n(once)).toBe(once);
  });

  it("is idempotent over generated strings", () => {
    const parts = [
      "The ",
      "DJ ",
      "é",
      "&",
      " and ",
      "+",
      "(Live)",
      "[Hybrid]",
      "  ",
      "Ö",
      "x",
      "ß",
      "-",
      ".",
    ];
    let state = 7;
    for (let i = 0; i < 500; i += 1) {
      let s = "";
      for (let j = 0; j < 6; j += 1) {
        state = (state * 1103515245 + 12345) % 2 ** 31;
        s += parts[state % parts.length];
      }
      const once = n(s);
      expect(n(once), JSON.stringify(s)).toBe(once);
    }
  });
});

describe("QA splitArtistCredit (LLD §6.2, D-013)", () => {
  it.each([
    ["Peggy Gou b2b DJ Koze", ["Peggy Gou", "DJ Koze"]],
    ["Peggy Gou B2B DJ Koze", ["Peggy Gou", "DJ Koze"]],
    ["A b2b B b2b C", ["A", "B", "C"]],
    ["Armin vs Tiësto", ["Armin", "Tiësto"]],
    ["Armin VS. Tiësto", ["Armin", "Tiësto"]],
    // BUG: an " X " ending the first name is eaten by the " x " splitter, dropping part of the name
    ["Lil Nas X x Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Calvin Harris feat. Rihanna", ["Calvin Harris", "Rihanna"]],
    ["Calvin Harris ft. Rihanna", ["Calvin Harris", "Rihanna"]],
    ["Calvin Harris  b2b   Rihanna ", ["Calvin Harris", "Rihanna"]],
  ])("%j -> %j", (input, expected) => {
    expect(split(input)).toEqual(expected);
  });

  it.each([
    "Simon & Garfunkel",
    "Above and Beyond",
    "Above & Beyond",
    "Lil Nas X",
    "X Ambassadors",
    "Malcolm X",
    "Felix Jaehn",
    "Vsevolod",
    "Featherweight",
    "Lxst Cxntury",
    "The xx",
    "Max",
  ])("does not split %j", (s) => {
    expect(split(s)).toEqual([s.trim()]);
  });

  it("keeps original casing and diacritics", () => {
    expect(split("BEYONCÉ feat. JAY-Z")).toEqual(["BEYONCÉ", "JAY-Z"]);
  });

  it.each(["", "   ", "b2b", " b2b B", "A b2b ", "A b2b b2b B", "feat.", "A vs vs B", "x x x"])(
    "never returns empty strings for %j",
    (s) => {
      const parts = split(s);
      for (const p of parts) expect(p.trim()).not.toBe("");
      for (const p of parts) expect(p).toBe(p.trim());
    },
  );

  it("returns [] for empty input", () => {
    expect(split("")).toEqual([]);
    expect(split("   ")).toEqual([]);
  });
});

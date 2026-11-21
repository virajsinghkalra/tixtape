import { describe, expect, it } from "vitest";
import { COPY, inCity, justLanded, typoChip } from "./ux-copy";

/** Words that carry meaning; emoji and arrows don't count. */
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

describe("UX copy (D-082)", () => {
  it.each(Object.entries(COPY))("%s is at most 4 words: %s", (_key, text) => {
    expect(words(text).length).toBeGreaterThanOrEqual(1);
    expect(words(text).length).toBeLessThanOrEqual(4);
  });

  it("never mentions login, counts or durations", () => {
    for (const text of Object.values(COPY)) {
      expect(text).not.toMatch(/login|log in|sign in|\d|minute|song/i);
    }
  });

  it("templates add at most 2 words to the name", () => {
    expect(justLanded("Coldplay")).toBe("Coldplay just landed");
    expect(inCity("Mumbai")).toBe("In Mumbai");
    expect(typoChip("Diljit")).toBe("Diljit?");
  });
});

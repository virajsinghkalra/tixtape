import { describe, expect, it } from "vitest";
import { SAVE_COPY } from "./save-copy";

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

describe("save copy (D-082, D-092)", () => {
  it.each(Object.entries(SAVE_COPY))("%s is 1–4 words: %s", (_k, text) => {
    expect(words(text).length).toBeGreaterThanOrEqual(1);
    expect(words(text).length).toBeLessThanOrEqual(4);
  });
});

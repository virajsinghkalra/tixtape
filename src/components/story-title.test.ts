import { describe, expect, it } from "vitest";
import { shortName } from "./story-title";

describe("shortName (story header)", () => {
  it.each([
    ["Lollapalooza India 2027", "Lollapalooza"],
    ["+−=÷× Tour", "gig"],
    ["2027", "gig"],
    ["★ Sunburn Goa", "Sunburn"],
  ])("%s → %s", (title, expected) => {
    expect(shortName(title)).toBe(expected);
  });
});

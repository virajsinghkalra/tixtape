import { describe, expect, it } from "vitest";
import { HAPTIC_PATTERN, hapticsAllowed } from "./feedback";

describe("haptics (UX #9)", () => {
  it("short, distinct patterns", () => {
    expect(HAPTIC_PATTERN).toEqual({ tap: 8, success: [12, 40, 12], warn: 20 });
  });
  it("never under reduced motion or in a hidden tab", () => {
    expect(hapticsAllowed({ reducedMotion: false, hidden: false })).toBe(true);
    expect(hapticsAllowed({ reducedMotion: true, hidden: false })).toBe(false);
    expect(hapticsAllowed({ reducedMotion: false, hidden: true })).toBe(false);
  });
});

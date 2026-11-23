import { describe, expect, it } from "vitest";
import { isPlaceholderVenue, venueName } from "./venue";

describe("venue placeholders", () => {
  it.each(["Venue TBA", "venue tba", "TBA", "TBD", "To be announced", " TBC ", "", null])(
    "%s is a placeholder",
    (n) => expect(isPlaceholderVenue(n)).toBe(true),
  );
  it("keeps real names", () => {
    expect(venueName(" Mahalaxmi Lawns ")).toBe("Mahalaxmi Lawns");
    expect(venueName("TBA Arena")).toBe("TBA Arena");
    expect(venueName("Venue TBA")).toBeNull();
  });
});

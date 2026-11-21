import { describe, expect, it } from "vitest";
import { visualFor } from "./event-visual";

describe("visualFor (D-082)", () => {
  it("prefers the official poster", () => {
    expect(visualFor("https://sunburn.in/p.jpg", ["https://i.scdn.co/a"], "Sunburn")).toEqual({
      kind: "poster",
      url: "https://sunburn.in/p.jpg",
    });
  });
  it("collages up to 4 distinct headliner photos, skipping missing ones", () => {
    expect(visualFor(null, [null, "a", "b", "a", "c", "d", "e"], "HOME")).toEqual({
      kind: "faces",
      urls: ["a", "b", "c", "d"],
    });
  });
  it("falls back to a sticker label, never an empty block", () => {
    expect(visualFor(undefined, [null], "Echoes of Earth")).toEqual({
      kind: "fallback",
      label: "Echoes of Earth",
    });
  });
});

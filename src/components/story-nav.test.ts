import { describe, expect, it } from "vitest";
import { adjacentShow } from "./story-nav";

describe("adjacentShow", () => {
  const ids = ["a", "b", "c"];
  it("moves along the row", () => {
    expect(adjacentShow(ids, "a", 1)).toBe("b");
    expect(adjacentShow(ids, "c", -1)).toBe("b");
  });
  it("is null past either end or for an unknown show", () => {
    expect(adjacentShow(ids, "c", 1)).toBeNull();
    expect(adjacentShow(ids, "a", -1)).toBeNull();
    expect(adjacentShow(ids, "x", 1)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { scorePrediction } from "./prediction-score";

describe("scorePrediction", () => {
  it("counts hits through title normalisation", () => {
    const s = scorePrediction(
      ['Kesariya (From "Brahmastra")', "Yellow", "Clocks"],
      ["kesariya", "Yellow - Live", "Fix You", "Magic"],
    );
    expect(s).toEqual({ hits: 2, actualCount: 4, recall: 0.5, precision: 2 / 3 });
  });

  it("ignores duplicate titles on both sides", () => {
    const s = scorePrediction(["A", "a", "B"], ["A", "A", "C"]);
    expect(s).toEqual({ hits: 1, actualCount: 2, recall: 0.5, precision: 0.5 });
  });

  it("is zero, not NaN, for empty inputs", () => {
    expect(scorePrediction([], ["A"])).toEqual({
      hits: 0,
      actualCount: 1,
      recall: 0,
      precision: 0,
    });
    expect(scorePrediction(["A"], [])).toEqual({
      hits: 0,
      actualCount: 0,
      recall: 0,
      precision: 0,
    });
  });
});

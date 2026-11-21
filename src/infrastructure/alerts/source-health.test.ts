import { describe, expect, it } from "vitest";
import { trackSourceRuns } from "./source-health";

const fail = { source: "wikipedia", error: "HTTP 503" };
const okRun = { source: "wikipedia", error: null };

describe("trackSourceRuns", () => {
  it("alerts on the third failure in a row, not before", () => {
    let state = {};
    const sent: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = trackSourceRuns(state, [fail]);
      state = r.state;
      if (r.alerts.length > 0) sent.push(i);
    }
    expect(sent).toEqual([3]);
  });

  it("a success resets the count", () => {
    const r1 = trackSourceRuns({ wikipedia: 2 }, [okRun]);
    expect(r1.state).toEqual({ wikipedia: 0 });
    expect(trackSourceRuns(r1.state, [fail]).alerts).toEqual([]);
  });

  it("reminds every 8 runs while the source stays down", () => {
    const at = (n: number) => trackSourceRuns({ wikipedia: n - 1 }, [fail]).alerts.length;
    expect([3, 4, 10, 11, 19].map(at)).toEqual([1, 0, 0, 1, 1]);
  });

  it("tracks sources independently", () => {
    const r = trackSourceRuns({ wikipedia: 2, pollstar: 2 }, [
      fail,
      { source: "pollstar", error: null },
    ]);
    expect(r.alerts.map((a) => a.key)).toEqual(["source-failing:wikipedia"]);
  });
});

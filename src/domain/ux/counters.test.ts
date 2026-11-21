import { describe, expect, it } from "vitest";
import { isUxEvent, rateVital, routeGroup, viaMetric, vitalMetric } from "./counters";

describe("isUxEvent", () => {
  it.each([
    ["og_hit", true],
    ["install_accepted", true],
    ["OG_HIT", false],
    ["og_hit;drop table", false],
    ["user:42", false],
    [42, false],
    [null, false],
  ])("%s → %s", (raw, expected) => expect(isUxEvent(raw)).toBe(expected));
});

describe("rateVital", () => {
  it.each([
    ["lcp", 2500, "good"],
    ["lcp", 2501, "ni"],
    ["lcp", 4001, "poor"],
    ["inp", 200, "good"],
    ["inp", 501, "poor"],
    ["cls", 0.05, "good"],
    ["cls", 0.2, "ni"],
    ["cls", 0.3, "poor"],
  ] as const)("%s %s → %s", (vital, value, expected) =>
    expect(rateVital(vital, value)).toBe(expected),
  );
});

describe("routeGroup", () => {
  it.each([
    ["/", "home"],
    ["/events/c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3", "event"],
    ["/search", "search"],
    ["/searching", "other"],
    ["/admin", "other"],
  ])("%s → %s", (path, expected) => expect(routeGroup(path)).toBe(expected));
});

it("builds a vitals metric with no path in it", () => {
  expect(vitalMetric("lcp", 1800, "/events/abc")).toBe("vitals:event:lcp:good");
});

describe("viaMetric", () => {
  it.each([
    ["wa", "view_via_wa"],
    ["native", "view_via_native"],
    ["email", null],
    ["", null],
    [null, null],
  ])("%s → %s", (via, expected) => expect(viaMetric(via)).toBe(expected));
});

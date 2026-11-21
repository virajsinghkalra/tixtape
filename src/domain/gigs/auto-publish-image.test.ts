import { describe, expect, it } from "vitest";
import { applyImageRule, autoPublishDecision, type GateDecision } from "./auto-publish";

const publishing: GateDecision = {
  decision: "publish",
  reasons: [],
  checks: [{ rule: "confidence", ok: true, detail: "0.95" }],
  path: "standard",
  confidence: 0.95,
  alternatives: {
    first_party: { rule: "first_party_grounded", ok: false, detail: "-" },
    press: { rule: "press_confirmed", ok: false, detail: "-" },
  },
};
const photo = {
  posterUrl: null,
  headliners: [{ imageUrl: "https://i.scdn.co/x.jpg", altImageUrl: null }],
};
const bare = { posterUrl: null, headliners: [{ imageUrl: null, altImageUrl: null }] };

describe("auto-publish image rule (D-091)", () => {
  it("holds a night that would publish without a picture, with reason no_image", () => {
    const gate = applyImageRule(publishing, bare);
    expect(gate).toMatchObject({ decision: "hold", path: null, confidence: null });
    expect(gate.reasons).toEqual(["has_image: no_image: Add a poster or a headliner photo first"]);
    expect(gate.checks.at(-1)).toMatchObject({ rule: "has_image", ok: false });
  });

  it.each([
    ["a headliner photo", photo, "picture: headliner_photo"],
    ["a poster", { posterUrl: "https://sunburn.in/p.jpg", headliners: [] }, "picture: poster"],
  ])("publishes with %s", (_label, visual, detail) => {
    const gate = applyImageRule(publishing, visual);
    expect(gate).toMatchObject({ decision: "publish", path: "standard", confidence: 0.95 });
    expect(gate.checks.at(-1)).toEqual({ rule: "has_image", ok: true, detail });
  });

  it("never turns a hold or a reject into a publish, and records the check", () => {
    for (const decision of ["hold", "reject"] as const) {
      const gate = applyImageRule({ ...publishing, decision, path: null, reasons: ["x"] }, photo);
      expect(gate.decision).toBe(decision);
      expect(gate.reasons).toEqual(["x"]);
    }
  });

  it("autoPublishDecision applies the rule only when a visual is given (re-checks never unpublish)", () => {
    const input = {
      now: new Date("2026-11-22T00:00:00Z"),
      sources: [],
      headlinerMatch: null,
      archivedLineups: [],
      confidence: 0,
    };
    expect(autoPublishDecision(input).checks.some((c) => c.rule === "has_image")).toBe(false);
    const withVisual = autoPublishDecision({ ...input, visual: null });
    expect(withVisual.checks.find((c) => c.rule === "has_image")).toMatchObject({ ok: false });
    expect(withVisual.decision).not.toBe("publish");
  });
});

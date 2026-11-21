import { describe, expect, it } from "vitest";
import { buildEventPatch, fromIstInput, moveRow, toIstInput, type EventForm } from "./event-edit";

const initial: EventForm = {
  startsAt: "2026-12-18T19:00",
  endsAt: "",
  venue: { name: "Jio World Garden", city: "Mumbai", state: "", country: "IN" },
  url: "https://sunburn.in/",
  lineup: [
    { key: "a", name: "DJ Snake", tier: "headliner", day: 1, stage: null },
    { key: "b", name: "Anyma", tier: "sub", day: null, stage: null },
  ],
};

describe("IST inputs", () => {
  it("round-trips a UTC instant through an IST datetime-local value", () => {
    expect(toIstInput("2026-12-18T13:30:00.000Z")).toBe("2026-12-18T19:00");
    expect(fromIstInput("2026-12-18T19:00")).toBe("2026-12-18T19:00:00+05:30");
    expect(new Date(fromIstInput("2026-12-18T19:00")!).toISOString()).toBe(
      "2026-12-18T13:30:00.000Z",
    );
  });

  it.each(["", "2026-12-18", "2026-13-40T99:99", "18/12/2026 19:00"])("rejects %j", (value) => {
    expect(fromIstInput(value)).toBeNull();
  });

  it("shows an empty input for no date", () => {
    expect(toIstInput(null)).toBe("");
  });
});

describe("moveRow", () => {
  it("moves up and down and ignores moves off either end", () => {
    expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("buildEventPatch", () => {
  it("refuses an unchanged form", () => {
    expect(buildEventPatch(initial, initial)).toEqual({
      ok: false,
      errors: ["Nothing has changed yet."],
    });
  });

  it("sends only the changed dates, as ISO with the IST offset", () => {
    const result = buildEventPatch(initial, { ...initial, endsAt: "2026-12-19T23:00" });
    expect(result).toEqual({
      ok: true,
      patch: { endsAt: "2026-12-19T23:00:00+05:30" },
      changes: ["End date"],
    });
  });

  it("clears the link with null and uppercases the country", () => {
    const result = buildEventPatch(initial, {
      ...initial,
      url: "  ",
      venue: { ...initial.venue, country: "in", state: " Maharashtra " },
    });
    expect(result.ok && result.patch).toEqual({
      url: null,
      venue: { name: "Jio World Garden", city: "Mumbai", country: "IN", state: "Maharashtra" },
    });
  });

  it("sends the whole lineup in the new order, keeping day and stage, without keys", () => {
    const reordered = moveRow(initial.lineup, 1, -1).map((r) =>
      r.key === "b" ? { ...r, tier: "headliner" as const } : r,
    );
    const result = buildEventPatch(initial, { ...initial, lineup: reordered });
    expect(result.ok && result.patch).toEqual({
      lineup: [
        { name: "Anyma", tier: "headliner" },
        { name: "DJ Snake", tier: "headliner", day: 1 },
      ],
    });
  });

  it("collects every validation problem at once", () => {
    const result = buildEventPatch(initial, {
      ...initial,
      startsAt: "2026-12-18T19:00",
      endsAt: "2026-12-17T19:00",
      venue: { name: "", city: "Mumbai", state: "", country: "IND" },
      url: "javascript:alert(1)",
      lineup: [],
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        "The end can't be before the start.",
        "Enter the venue name.",
        "Use a two-letter country code, e.g. IN.",
        "Add at least one artist.",
        "The event link must start with http:// or https://.",
      ],
    });
  });

  it("rejects blank artist names and a missing start", () => {
    const result = buildEventPatch(initial, {
      ...initial,
      startsAt: "",
      lineup: [{ key: "x", name: "  ", tier: "support", day: null, stage: null }],
    });
    expect(result.ok ? [] : result.errors).toEqual([
      "Enter a start date and time.",
      "Every lineup row needs an artist name.",
    ]);
  });
});

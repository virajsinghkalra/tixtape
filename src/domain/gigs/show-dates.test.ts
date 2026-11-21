import { describe, expect, it } from "vitest";
import { isoDate } from "./extract";
import { atIstTime, findDateMentions, findShowTime } from "./show-dates";

const nightsOf = (text: string) =>
  findDateMentions(text).map((m) =>
    m.kind === "nights"
      ? { kind: m.kind, nights: m.nights.map(isoDate), quote: m.quote }
      : { kind: m.kind, start: isoDate(m.start), end: isoDate(m.end), quote: m.quote },
  );

describe("findDateMentions", () => {
  it.each([
    ["Mumbai | 5th, 6th and 9th December 2026", ["2026-12-05", "2026-12-06", "2026-12-09"]],
    ["05th, 06th & 09th December 2026 Mumbai", ["2026-12-05", "2026-12-06", "2026-12-09"]],
    ["Sat 5 Dec 2026 at 7:30 PM", ["2026-12-05"]],
    ["December 5, 6 and 9, 2026", ["2026-12-05", "2026-12-06", "2026-12-09"]],
    ["Dec 12, 2026", ["2026-12-12"]],
    ["12th & 13th December 2026", ["2026-12-12", "2026-12-13"]],
    ["on 05.12.2026", ["2026-12-05"]],
    ["Saturday, 16 January 2027", ["2027-01-16"]],
  ])("reads listed nights in %j", (text, nights) => {
    expect(nightsOf(text)).toEqual([expect.objectContaining({ kind: "nights", nights })]);
  });

  it("keeps a listing range as a range (it doesn't say which nights are shows)", () => {
    expect(nightsOf("Sat 5 Dec 2026 - Wed 9 Dec 2026 · 7:30 PM")).toEqual([
      expect.objectContaining({ kind: "range", start: "2026-12-05", end: "2026-12-09" }),
    ]);
    expect(nightsOf("5–9 December 2026")).toEqual([
      expect.objectContaining({ kind: "range", start: "2026-12-05", end: "2026-12-09" }),
    ]);
    expect(nightsOf("29 Dec – 2 Jan 2027")).toEqual([
      expect.objectContaining({ kind: "range", start: "2026-12-29", end: "2027-01-02" }),
    ]);
  });

  it.each([
    ["Mumbai | 5th, 6th and 9th December", "no year"],
    ["27.11.26 SEATING TIME 8:30PM", "two-digit year"],
    ["it may 5 be fine 2026", "'may' in prose"],
    ["31 February 2027", "impossible date"],
    ["Dec 2026", "no day"],
  ])("never infers a date: %j (%s)", (text) => {
    expect(findDateMentions(text)).toEqual([]);
  });

  it("returns the exact text span as the quote", () => {
    const text = "Bhuwin Experience SKETCHBOOK 05th, 06th & 09th December 2026 Mumbai - OML HQ";
    const [m] = findDateMentions(text);
    expect(m?.quote).toBe("05th, 06th & 09th December 2026");
    expect(text.includes(m!.quote)).toBe(true);
  });

  it("rejects ranges longer than a month", () => {
    expect(findDateMentions("1 Jan 2027 - 30 Mar 2027")).toEqual([]);
  });
});

describe("findShowTime", () => {
  it.each([
    ["7:30 PM", "19:30"],
    ["Doors 8PM", "20:00"],
    ["at 7.30 p.m.", "19:30"],
    ["12 pm", "12:00"],
    ["12:15 am", "00:15"],
    ["19:30 hrs", "19:30"],
  ])("%j → %s", (text, hhmm) => {
    expect(findShowTime(text)?.hhmm).toBe(hhmm);
  });

  it("finds nothing without a time", () => {
    expect(findShowTime("5 December 2026, Mumbai")).toBeNull();
  });

  it("adds an IST time to a night", () => {
    const night = new Date("2026-12-05T00:00:00+05:30");
    expect(atIstTime(night, "19:30").toISOString()).toBe("2026-12-05T14:00:00.000Z");
  });
});

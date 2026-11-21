import { describe, expect, it } from "vitest";
import { findDateRanges, parseDateRange } from "./dates";

const now = new Date("2026-11-21T10:00:00Z");
/** 00:00 IST on a calendar date, as an ISO string. */
const ist = (date: string) => new Date(`${date}T00:00:00+05:30`).toISOString();

describe("parseDateRange", () => {
  it.each([
    ["Feb. 13, 2027", "2027-02-13", null, true],
    ["on 13 February 2027 at", "2027-02-13", null, true],
    ["13th February, 2027", "2027-02-13", null, true],
    ["Dec 12–13", "2026-12-12", "2026-12-13", false],
    ["Dec 12-13, 2026", "2026-12-12", "2026-12-13", true],
    ["12th & 13th December 2026", "2026-12-12", "2026-12-13", true],
    ["December 18th and 19th, 2026", "2026-12-18", "2026-12-19", true],
    ["29th–30th December, 2026", "2026-12-29", "2026-12-30", true],
    ["29 November – 1 December", "2026-11-29", "2026-12-01", false],
    ["29 December – 2 January 2027", "2026-12-29", "2027-01-02", true],
    ["January 28–29, 2023", "2023-01-28", "2023-01-29", true],
    ["1-2 November", "2027-11-01", "2027-11-02", false],
    ["on 13 February", "2027-02-13", null, false],
    ["the 20th of November", "2026-11-20", null, false],
  ])("%s", (text, start, end, yearGiven) => {
    // Articles may read a year-less date relative to their publish date (here: now).
    const r = parseDateRange(text, now, { inferYear: true });
    expect(r?.start.toISOString()).toBe(ist(start));
    expect(r?.end?.toISOString() ?? null).toBe(end === null ? null : ist(end));
    expect(r?.yearGiven).toBe(yearGiven);
  });

  it.each([
    ["no date here"],
    ["31 February 2027"],
    ["it may 2 be"],
    ["in 2011"],
    ["Nov. 30–2, 2026"],
  ])("finds nothing in %j", (text) => {
    expect(parseDateRange(text, now)).toBeNull();
  });

  it("never guesses a year unless asked (D-054): year-less dates are dropped by default", () => {
    expect(parseDateRange("16 March", now)).toBeNull();
    expect(parseDateRange("Dec 12–13", now)).toBeNull();
    expect(parseDateRange("16 March 2024", now)?.start.toISOString()).toBe(ist("2024-03-16"));
  });

  it("reads a year-less date relative to the reference (publish) date, not to now", () => {
    const published = new Date("2024-02-20T00:00:00Z");
    expect(parseDateRange("16 March", published, { inferYear: true })?.start.toISOString()).toBe(
      ist("2024-03-16"),
    );
  });

  it("finds every date in reading order, with positions", () => {
    const text = "Presale on Nov. 23, 2026; the show is on 13 February 2027.";
    const found = findDateRanges(text, now);
    expect(found.map((r) => r.start.toISOString())).toEqual([ist("2026-11-23"), ist("2027-02-13")]);
    expect(found[1]!.index).toBe(text.indexOf("13 February"));
  });
});

import { describe, expect, it } from "vitest";
import { monthWindow, weekendWindow, yearWindow } from "./ist-calendar";
import { compactAlnum, parseSearchText, splitAlnum } from "./query-parse";

/** Wednesday 25 Nov 2026, 11:30 IST. */
const now = new Date("2026-11-25T06:00:00Z");
const parse = (q: string) => parseSearchText(q, now);

describe("alphanumeric spacing (issue 6)", () => {
  it.each([
    [["nh", "7"], ["nh7"]],
    [
      ["vh", "1", "supersonic"],
      ["vh1", "supersonic"],
    ],
    [
      ["lolla", "2027"],
      ["lolla", "2027"],
    ],
    [
      ["blink", "182"],
      ["blink", "182"],
    ],
    [["a", "1"], ["a1"]],
  ])("%j → %j", (tokens, expected) => {
    expect(compactAlnum(tokens)).toEqual(expected);
  });

  it.each([
    ["nh7 weekender", "nh 7 weekender"],
    ["vh1", "vh 1"],
    ["lollapalooza", "lollapalooza"],
  ])("splitAlnum %j → %j", (text, expected) => {
    expect(splitAlnum(text)).toEqual(expected);
  });

  it("NH 7 and nh7 parse to the same text", () => {
    expect(parse("NH 7").text).toBe("nh7");
    expect(parse("nh7").text).toBe("nh7");
  });
});

describe("city filters and filler words (issue 2)", () => {
  it.each([
    // QA-F-4: "concerts", "gigs", "shows" mean any live event, festivals included.
    ["concerts in pune", "", { city: "Pune" }],
    ["gigs in pune", "", { city: "Pune" }],
    ["lolla mumbai", "lolla", { city: "Mumbai" }],
    ["shows at bombay", "", { city: "Mumbai" }],
    ["live events near bangalore", "", { city: "Bengaluru" }],
    ["pune", "", { city: "Pune" }],
    ["pune concerts", "", { city: "Pune" }],
    ["shows in mumbai", "", { city: "Mumbai" }],
    ["sunburn goa", "sunburn", { city: "Goa" }],
    ["new delhi", "", { city: "Delhi" }],
    ["navi mumbai", "", { city: "Navi Mumbai" }],
    // A city at the start of a longer name stays text: it's probably a band or a title.
    ["bombay bicycle club", "bombay bicycle club", {}],
    ["prateek kuhad tickets", "prateek kuhad", {}],
    // Only filler: search for it as typed instead of nothing.
    ["live", "live", {}],
    ["in", "in", {}],
  ])("%j → text %j, filters %j", (q, text, filters) => {
    const parsed = parse(q);
    expect(parsed.text).toBe(text);
    expect(parsed.filters).toEqual(filters);
  });
});

describe("date phrases (issues 3 and 4)", () => {
  it.each([
    ["this weekend", weekendWindow(now)],
    ["weekend", weekendWindow(now)],
    ["next weekend", weekendWindow(now, 1)],
    ["december", monthWindow(2026, 11)],
    ["dec", monthWindow(2026, 11)],
    ["march", monthWindow(2027, 2)],
    ["december 2027", monthWindow(2027, 11)],
    ["2027", yearWindow(2027)],
    ["this month", monthWindow(2026, 10)],
    ["next month", monthWindow(2026, 11)],
  ])("%j → window, no text left", (q, window) => {
    const parsed = parse(q);
    expect(parsed.text).toBe("");
    expect(parsed.filters).toEqual(window);
    expect(parsed.filterLabel).toBe(q);
  });

  it.each([
    ["today", "2026-11-24T18:30:00.000Z", "2026-11-25T18:29:59.999Z"],
    ["tonight", "2026-11-24T18:30:00.000Z", "2026-11-25T18:29:59.999Z"],
    ["tomorrow", "2026-11-25T18:30:00.000Z", "2026-11-26T18:29:59.999Z"],
  ])("%j is an IST day", (q, from, to) => {
    const { filters } = parse(q);
    expect([filters.from?.toISOString(), filters.to?.toISOString()]).toEqual([from, to]);
  });

  it("removes the date words so fuzzy can't match them ('weekend' vs 'Weekender')", () => {
    expect(parse("this weekend").text).toBe("");
    expect(parse("weekender").text).toBe("weekender");
  });

  it("combines with text and city", () => {
    const parsed = parse("lolla 2027");
    expect(parsed.text).toBe("lolla");
    expect(parsed.filters).toEqual(yearWindow(2027));
    const combo = parse("gigs in pune this weekend");
    expect(combo.text).toBe("");
    expect(combo.filters).toEqual({ city: "Pune", ...weekendWindow(now) });
  });
});

describe("type and genre (issue 5)", () => {
  it.each([
    ["festival", "", { type: "festival" }],
    ["festivals", "", { type: "festival" }],
    // Only filler: searched as typed rather than nothing.
    ["concert", "concert", {}],
    ["ziro festival", "ziro", { type: "festival" }],
    ["edm", "", { genre: "edm" }],
    ["hip hop", "", { genre: "hip hop" }],
    ["punjabi in delhi", "", { genre: "punjabi", city: "Delhi" }],
    ["techno this weekend", "", { genre: "techno", ...weekendWindow(now) }],
    // A genre word next to other text stays text: "100% Bollywood Night" must still match.
    ["bollywood night", "bollywood night", {}],
    ["hard rock cafe", "hard rock cafe", {}],
  ])("%j → text %j, filters %j", (q, text, filters) => {
    const parsed = parse(q);
    expect(parsed.text).toBe(text);
    expect(parsed.filters).toEqual(filters);
  });
});

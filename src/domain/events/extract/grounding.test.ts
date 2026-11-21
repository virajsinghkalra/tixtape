import { describe, expect, it } from "vitest";
import { allowedDomain } from "./allow-list";
import { groundExtraction } from "./grounding";

const page = `Sunburn Festival 2026 full line-up announced.
The festival returns to Mahalaxmi Racecourse in Mumbai on December 18 and 19, 2026.
Headlining are DJ Snake, The Chainsmokers, Sebastian Ingrosso and Anyma, with support from Nikhil Chinapa.`;

const reply = {
  title: "Sunburn Festival 2026",
  startDate: "2026-12-18",
  endDate: "2026-12-19",
  city: "Mumbai",
  venue: "Mahalaxmi Racecourse",
  headliners: ["DJ Snake", "The Chainsmokers", "Sebastian Ingrosso", "Anyma"],
  support: ["Nikhil Chinapa"],
  quotes: {
    title: "Sunburn Festival 2026 full line-up announced",
    startDate: "on December 18 and 19, 2026",
    city: "Mahalaxmi Racecourse in Mumbai",
    venue: "returns to Mahalaxmi Racecourse",
    headliners: "Headlining are DJ Snake, The Chainsmokers, Sebastian Ingrosso and Anyma",
    support: "with support from Nikhil Chinapa",
  },
};

describe("groundExtraction (D-064)", () => {
  it("keeps every field whose quote is verbatim in the page and states it", () => {
    const g = groundExtraction(reply, page);
    expect(g).toEqual({
      title: "Sunburn Festival 2026",
      startsAt: new Date("2026-12-18T00:00:00+05:30"),
      endsAt: new Date("2026-12-19T00:00:00+05:30"),
      city: "Mumbai",
      venue: "Mahalaxmi Racecourse",
      headliners: ["DJ Snake", "The Chainsmokers", "Sebastian Ingrosso", "Anyma"],
      support: ["Nikhil Chinapa"],
      dropped: [],
    });
  });

  it("drops a field whose quote is missing or not verbatim", () => {
    const g = groundExtraction(
      {
        ...reply,
        quotes: {
          ...reply.quotes,
          venue: undefined,
          city: "the festival is held in Mumbai",
        },
      },
      page,
    );
    expect(g.venue).toBeNull();
    expect(g.city).toBeNull();
    expect(g.dropped).toEqual(
      expect.arrayContaining(["venue: no verbatim quote", expect.stringMatching(/^city:/u)]),
    );
  });

  it("drops a date whose quote doesn't state the year (never inferred)", () => {
    const g = groundExtraction(
      { ...reply, quotes: { ...reply.quotes, startDate: "on December 18 and 19" } },
      page,
    );
    expect(g.startsAt).toBeNull();
    expect(g.dropped[0]).toMatch(/startDate: quote does not state this date with its year/u);
  });

  it("drops artists the quote doesn't name (an invented headliner)", () => {
    const g = groundExtraction(
      { ...reply, headliners: [...reply.headliners, "Jason Derulo"] },
      page,
    );
    expect(g.headliners).not.toContain("Jason Derulo");
    expect(g.dropped).toContain("headliners: not in the quote: Jason Derulo");
  });

  it("ignores curly quotes, dashes and spacing when matching quotes", () => {
    const g = groundExtraction(
      {
        title: "Sunburn Festival 2026",
        quotes: { title: "Sunburn  Festival 2026 full line‑up announced" },
      },
      page,
    );
    expect(g.title).toBe("Sunburn Festival 2026");
  });

  it("rejects a reply that isn't the agreed JSON", () => {
    expect(groundExtraction({ startDate: "next Friday" }, page).dropped).toEqual([
      "all: the reply was not the agreed JSON",
    ]);
  });
});

describe("allowedDomain (D-064)", () => {
  it.each([
    ["https://sunburn.in/event/sunburn-festival-2026/", "official", "sunburn"],
    ["https://djmag.com/news/sunburn-2026-lineup", "trusted", undefined],
    ["https://www.djmag.com/news/x", "trusted", undefined],
    ["https://www.esquireindia.co.in/culture/home-festival-goa-2026", "trusted", undefined],
    ["https://en.wikipedia.org/wiki/Sunburn_Festival", "trusted", "wikipedia"],
  ])("%s is allowed", (url, trust, source) => {
    expect(allowedDomain(url)).toMatchObject({ trust, ...(source ? { source } : {}) });
  });

  it.each([
    "https://in.bookmyshow.com/events/sunburn-festival-2026/ET00498558",
    "https://www.instagram.com/sunburnfestival/",
    "https://www.district.in/events/x",
    "https://www.timeout.com/mumbai/x",
    "https://www.hindustantimes.com/x",
    "https://randomblog.example/sunburn",
    "javascript:alert(1)",
  ])("%s is not", (url) => {
    expect(allowedDomain(url)).toBeNull();
  });
});

describe("D-070 regressions", () => {
  it("only English Wikipedia is allowed, and as a trusted outlet, never official", () => {
    expect(allowedDomain("https://xx.wikipedia.org/wiki/Sunburn_Festival")).toBeNull();
    expect(allowedDomain("https://en.wikipedia.org/wiki/Sunburn_Festival")?.trust).toBe("trusted");
  });

  it("rejects an oversized model reply whole (array sizes, string lengths)", () => {
    const many = Array.from({ length: 61 }, (_, i) => `Artist ${i}`);
    expect(groundExtraction({ ...reply, headliners: many }, page).dropped).toEqual([
      "all: the reply was not the agreed JSON",
    ]);
    expect(groundExtraction({ ...reply, title: "x".repeat(201) }, page).dropped).toEqual([
      "all: the reply was not the agreed JSON",
    ]);
    expect(
      groundExtraction({ ...reply, quotes: { ...reply.quotes, title: "y".repeat(601) } }, page)
        .dropped,
    ).toEqual(["all: the reply was not the agreed JSON"]);
  });
});

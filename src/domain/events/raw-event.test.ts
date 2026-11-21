import { describe, expect, it } from "vitest";
import { RawEventSchema, type RawLineupEntry } from "./raw-event";

const base = {
  source: "ticketmaster",
  externalId: "x1",
  title: "Sunburn Arena",
  type: "concert",
  startsAt: new Date("2026-12-28T12:00:00Z"),
  venue: { name: "NSCI Dome", city: "Mumbai", country: "IN" },
  lineup: [] as RawLineupEntry[],
  raw: {},
};

const credits = (n: number, make: (i: number) => string): RawLineupEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: make(i), tier: "support", billingRank: i + 1 }));

describe("RawEventSchema", () => {
  it.each([
    ["javascript: url", { url: "javascript:alert(1)" }],
    ["data: imageUrl", { imageUrl: "data:text/html,<script>alert(1)</script>" }],
    ["ftp: url", { url: "ftp://example.com" }],
  ])("rejects %s (ENGINEERING §7)", (_label, change) => {
    expect(RawEventSchema.safeParse({ ...base, ...change }).success).toBe(false);
  });

  it("accepts https links", () => {
    const r = RawEventSchema.safeParse({
      ...base,
      url: "https://www.ticketmaster.com/e/1",
      imageUrl: "https://s1.ticketm.net/a.jpg",
    });
    expect(r.success).toBe(true);
  });

  // Lead decision: the 300 limit counts artists after credit splitting.
  it.each([
    ["150 b2b credits = 300 artists", credits(150, (i) => `A${i} b2b B${i}`), true],
    ["151 b2b credits = 302 artists", credits(151, (i) => `A${i} b2b B${i}`), false],
    ["400 credits naming 300 distinct artists", credits(400, (i) => `Artist ${i % 300}`), true],
    ["301 distinct credits", credits(301, (i) => `Artist ${i}`), false],
  ])("%s → valid: %s", (_label, lineup, ok) => {
    expect(RawEventSchema.safeParse({ ...base, lineup }).success).toBe(ok);
  });
});

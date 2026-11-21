import { describe, expect, it } from "vitest";
import { fullJitterSeconds, parseRetryAfter } from "@/infrastructure/spotify/backoff";
import { SeqRandom, T0 } from "./fakes";

const now = new Date(T0);

describe("QA parseRetryAfter (LLD §8.2, §14)", () => {
  it.each([
    ["2", 2],
    ["0", 0],
    ["120", 120],
    ["121", 121],
    ["5000", 5000],
    ["99999999", 99999999],
  ])("delta-seconds %s → %s", (h, s) => {
    expect(parseRetryAfter(h, now)).toBe(s);
  });

  it("parses an HTTP-date in the future", () => {
    const h = new Date(T0 + 600_000).toUTCString();
    expect(parseRetryAfter(h, now)).toBeCloseTo(600, 0);
  });

  it("an HTTP-date in the past never yields a negative wait", () => {
    const h = new Date(T0 - 600_000).toUTCString();
    const v = parseRetryAfter(h, now);
    expect(v === null || v === 0).toBe(true);
  });

  it.each([
    null,
    "",
    "abc",
    "NaN",
    "-5",
    "-0.5",
    "2 seconds",
    "Infinity",
    "-Infinity",
    "0x10",
    "Wed, 99 Foo 2026",
  ])("garbage/negative %j is NaN-safe (null or a finite non-negative number)", (h) => {
    const v = parseRetryAfter(h, now);
    if (v !== null) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("negative delta is never honoured as a negative wait", () => {
    const v = parseRetryAfter("-5", now);
    expect(v === null || v >= 0).toBe(true);
  });

  it("an absurdly long digit string does not produce Infinity", () => {
    const v = parseRetryAfter("9".repeat(400), now);
    expect(v === null || Number.isFinite(v)).toBe(true);
  });
});

describe("QA fullJitterSeconds (D-006: full jitter capped at 60s)", () => {
  it.each([1, 2, 3, 5, 6, 7, 10, 50, 2000])("attempt %i stays in [0, min(60, 2^attempt)]", (a) => {
    for (const r of [0, 0.25, 0.5, 0.999999]) {
      const v = fullJitterSeconds(a, new SeqRandom(r));
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(Math.min(60, 2 ** a));
    }
  });

  it("is actually jittered (depends on random)", () => {
    expect(fullJitterSeconds(5, new SeqRandom(0.1))).not.toBe(
      fullJitterSeconds(5, new SeqRandom(0.9)),
    );
  });

  it("caps at 60s for large attempts even with random→1", () => {
    expect(fullJitterSeconds(30, new SeqRandom(0.999999))).toBeLessThanOrEqual(60);
    expect(fullJitterSeconds(30, new SeqRandom(0.999999))).toBeGreaterThan(59);
  });
});

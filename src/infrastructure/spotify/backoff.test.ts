import { describe, expect, it } from "vitest";
import { fullJitterSeconds, parseRetryAfter } from "./backoff";
import { fixedRandom, T0 } from "./test-support";

const now = new Date(T0);

describe("parseRetryAfter", () => {
  it.each([
    ["2", 2],
    [" 5000 ", 5000],
    ["0", 0],
    ["1.5", 1.5],
    [new Date(T0 + 30_000).toUTCString(), 30],
    [new Date(T0 - 30_000).toUTCString(), 0],
  ])("parses %j as %d seconds", (header, seconds) => {
    expect(parseRetryAfter(header, now)).toBe(seconds);
  });

  it.each([null, "", "abc", "-1", "NaN", "Infinity", "1e3", "2 seconds", "Mon, 99 Foo 2026 GMT"])(
    "returns null for %j",
    (header) => {
      expect(parseRetryAfter(header, now)).toBeNull();
    },
  );
});

describe("fullJitterSeconds", () => {
  it.each([
    [1, 1, 2],
    [2, 1, 4],
    [5, 1, 32],
    [6, 1, 60],
    [20, 1, 60],
    [3, 0, 0],
    [3, 0.5, 4],
  ])("attempt %d with random %d gives %d", (attempt, r, expected) => {
    expect(fullJitterSeconds(attempt, fixedRandom(r))).toBe(expected);
  });
});

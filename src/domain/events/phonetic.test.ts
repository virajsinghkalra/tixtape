import { describe, expect, it } from "vitest";
import { jaroWinkler } from "./similarity";
import {
  NAME_MATCH_THRESHOLD,
  phoneticKey,
  phoneticNameSimilarity,
  phoneticSqlSteps,
} from "./phonetic";

describe("phoneticKey", () => {
  it.each([
    ["diljeet", "diljit"],
    ["diljit", "diljit"],
    ["badshaah", "badsah"],
    ["badshah", "badsah"],
    ["lollapalooza", "lolapaluza"],
    ["shreya ghoshal", "sreya gosal"],
    ["sreya goshal", "sreya gosal"],
    ["prateek kuhad", "pratik kuhad"],
    ["prateik", "prateik"],
    ["dhvani bhanushali", "dvani banusali"],
    ["2027", "2027"],
    ["दिलजीत", "दिलजीत"],
  ])("%j → %j", (raw, key) => {
    expect(phoneticKey(raw)).toBe(key);
  });

  it("is idempotent", () => {
    for (const s of ["diljeet dosanjh", "badshaah", "arijit singh", "shankar mahadevan"]) {
      expect(phoneticKey(phoneticKey(s))).toBe(phoneticKey(s));
    }
  });

  it.each([
    ["diljeet", "diljit", 1],
    ["badshaah", "badshah", 1],
    ["arjit", "arijit", 0.9],
    ["shreya", "sreya", 1],
  ])("%j ≈ %j (JW on keys ≥ %f)", (a, b, min) => {
    expect(jaroWinkler(phoneticKey(a), phoneticKey(b))).toBeGreaterThanOrEqual(min);
  });

  it.each([
    ["arjit", "arijit singh", true],
    ["arijit", "arijit singh", true],
    ["diljeet", "diljit dosanjh", true],
    ["badshaah", "badshah", true],
    ["shreya goshal", "shreya ghoshal", true],
    ["arjun", "arijit singh", false],
    ["ritu", "ritviz", false],
    ["coldplay", "green day", false],
  ])("phoneticNameSimilarity(%j, %j) passes: %s (issue 11)", (q, name, ok) => {
    expect(phoneticNameSimilarity(q, name) >= NAME_MATCH_THRESHOLD).toBe(ok);
  });

  it("exposes the same literal steps for SQL, in the same order", () => {
    const steps = phoneticSqlSteps();
    expect(steps.slice(0, 3)).toEqual([
      { from: "ee", to: "i" },
      { from: "oo", to: "u" },
      { from: "aa", to: "a" },
    ]);
    expect(steps).toContainEqual({ from: "ll", to: "l" });
    // Applying the SQL steps with plain string replacement gives the same key.
    const viaSteps = (s: string) => steps.reduce((acc, st) => acc.replaceAll(st.from, st.to), s);
    for (const s of ["lollapalooza", "diljeet dosanjh", "badshaah", "shreya ghoshal"]) {
      expect(viaSteps(s)).toBe(phoneticKey(s));
    }
  });
});

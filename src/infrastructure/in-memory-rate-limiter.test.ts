import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./in-memory-rate-limiter";

const at = (ms: number) => new Date(Date.UTC(2026, 10, 25) + ms);

describe("InMemoryRateLimiter", () => {
  it("allows `limit` per window per key, then resets", async () => {
    const limiter = new InMemoryRateLimiter(2, 60_000);
    expect([
      await limiter.take("a", at(0)),
      await limiter.take("a", at(1)),
      await limiter.take("a", at(2)),
    ]).toEqual([true, true, false]);
    expect(await limiter.take("b", at(3))).toBe(true);
    expect(await limiter.take("a", at(60_000))).toBe(true);
  });

  it("sweeps expired keys once it holds too many", async () => {
    const limiter = new InMemoryRateLimiter(1, 1_000, 3);
    for (const k of ["a", "b", "c"]) await limiter.take(k, at(0));
    expect(await limiter.take("d", at(5_000))).toBe(true);
    // "a" was swept, so it starts a fresh window rather than staying blocked.
    expect(await limiter.take("a", at(5_001))).toBe(true);
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBe(2);
  });
});

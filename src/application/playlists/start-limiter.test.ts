import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "./start-limiter";
import { FakeClock } from "./testing/fakes";

describe("FixedWindowLimiter", () => {
  it("allows `limit` takes per key per window, then resets", async () => {
    const clock = new FakeClock();
    const limiter = new FixedWindowLimiter(2, 60_000, clock);
    expect([
      await limiter.tryTake("a"),
      await limiter.tryTake("a"),
      await limiter.tryTake("a"),
    ]).toEqual([true, true, false]);
    expect(await limiter.tryTake("b")).toBe(true);
    clock.advance(15_000);
    expect(limiter.retryAfterSeconds("a")).toBe(45);
    expect(limiter.retryAfterSeconds("b")).toBe(0);
    clock.advance(45_000);
    expect(await limiter.tryTake("a")).toBe(true);
  });
});

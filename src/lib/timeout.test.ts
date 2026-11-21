import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./timeout";

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the value when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 100, null)).resolves.toBe(7);
  });

  it("returns the fallback when the work is too slow", async () => {
    const slow = new Promise<number>((r) => setTimeout(() => r(1), 500));
    const result = withTimeout(slow, 100, "late");
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("late");
  });

  it("returns the fallback when the work fails", async () => {
    await expect(withTimeout(Promise.reject(new Error("db down")), 100, null)).resolves.toBeNull();
  });

  it("ignores a late failure after the fallback", async () => {
    const late = new Promise<number>((_, reject) => setTimeout(() => reject(new Error("x")), 500));
    const result = withTimeout(late, 100, 0);
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toBe(0);
  });
});

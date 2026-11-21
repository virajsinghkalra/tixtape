import type { RateLimiter } from "@/application/ports/engagement";

/**
 * Fixed-window counter per key, in this process's memory (D-047: no Redis on the free
 * tier, D-002). Good enough to blunt abuse of the anonymous popularity endpoints; each
 * serverless instance keeps its own counts.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Expired keys are swept once the map grows past this. */
    private readonly maxKeys = 10_000,
  ) {}

  async take(key: string, now: Date): Promise<boolean> {
    const t = now.getTime();
    const current = this.windows.get(key);
    if (!current || t - current.start >= this.windowMs) {
      if (!current && this.windows.size >= this.maxKeys) this.sweep(t);
      this.windows.set(key, { start: t, count: 1 });
      return this.limit >= 1;
    }
    current.count++;
    return current.count <= this.limit;
  }

  private sweep(t: number): void {
    for (const [key, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(key);
  }
}

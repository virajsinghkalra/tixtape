/**
 * In-memory fixed-window limit on build starts per client (D-036 abuse protection).
 * Known limit: per process, so N web instances allow N× the limit, and it resets on deploy.
 */
import type { Clock } from "@/application/ports/clock";

export interface StartLimiter {
  /** True and counts the attempt when `key` is under its limit; false otherwise. */
  tryTake(key: string): Promise<boolean>;
  /** Seconds until `key` may start again (0 when it may now). */
  retryAfterSeconds(key: string): number;
}

/** Above this many tracked keys, expired windows are swept before adding another. */
const SWEEP_THRESHOLD = 10_000;

export class FixedWindowLimiter implements StartLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  async tryTake(key: string): Promise<boolean> {
    const now = this.clock.now().getTime();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      if (this.windows.size >= SWEEP_THRESHOLD) this.sweep(now);
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count++;
    return true;
  }

  retryAfterSeconds(key: string): number {
    const current = this.windows.get(key);
    if (!current || current.count < this.limit) return 0;
    const left = current.startedAt + this.windowMs - this.clock.now().getTime();
    return Math.max(0, Math.ceil(left / 1000));
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) {
      if (now - w.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

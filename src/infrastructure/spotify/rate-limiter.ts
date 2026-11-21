import type { Clock } from "@/application/ports/clock";

export type Sleep = (ms: number) => Promise<void>;

/**
 * Per-process pacing for Spotify (LLD §8.2): a token bucket (~3 req/s) plus a cap on calls in
 * flight. Spotify publishes no numbers, so both are tunable.
 */
export class SpotifyRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private inFlight = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly opts: { requestsPerSecond: number; maxInFlight: number },
    private readonly clock: Clock,
    private readonly sleep: Sleep,
  ) {
    if (opts.requestsPerSecond <= 0 || opts.maxInFlight < 1) {
      throw new Error("Rate limiter needs requestsPerSecond > 0 and maxInFlight >= 1.");
    }
    this.tokens = opts.requestsPerSecond;
    this.lastRefill = clock.now().getTime();
  }

  /** Waits for a slot and a token. Call the returned function once the response has arrived. */
  async acquire(): Promise<() => void> {
    await this.takeSlot();
    try {
      await this.takeToken();
    } catch (e) {
      this.releaseSlot();
      throw e;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseSlot();
    };
  }

  get activeCount(): number {
    return this.inFlight;
  }

  private takeSlot(): Promise<void> {
    if (this.inFlight < this.opts.maxInFlight) {
      this.inFlight++;
      return Promise.resolve();
    }
    // The releasing caller hands its slot straight to the next waiter.
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight--;
  }

  /** Reserves a token now (the balance may go negative) and waits until it would have existed. */
  private async takeToken(): Promise<void> {
    const rate = this.opts.requestsPerSecond;
    const now = this.clock.now().getTime();
    this.tokens = Math.min(rate, this.tokens + ((now - this.lastRefill) / 1000) * rate);
    this.lastRefill = now;
    this.tokens -= 1;
    if (this.tokens < 0) await this.sleep(Math.ceil((-this.tokens / rate) * 1000));
  }
}

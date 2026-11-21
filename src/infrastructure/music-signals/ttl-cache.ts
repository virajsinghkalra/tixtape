/**
 * A small per-process cache with a time-to-live (D-038: signals are cached 24 hours per
 * artist). Bounded: when full, the oldest entry is dropped.
 */
import type { Clock } from "@/application/ports/clock";

export const DAY_MS = 24 * 60 * 60 * 1000;

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs = DAY_MS,
    private readonly maxEntries = 2_000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.clock.now().getTime() + this.ttlMs });
  }

  /** Returns the cached value, or loads, stores and returns it. Failures aren't cached. */
  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    this.set(key, value);
    return value;
  }
}

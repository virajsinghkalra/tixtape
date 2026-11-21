/**
 * Fixed-window rate limit in Postgres (D-070), so the limit holds across every serverless
 * instance instead of per process. One upsert per check:
 * `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`.
 *
 * The stored key is an HMAC of the limit name and the client key, so raw IPs never reach the
 * database. Old windows are removed by `deleteExpired` (the sweep).
 */
import { createHmac } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { Clock } from "@/application/ports/clock";
import type { RateLimiter } from "@/application/ports/engagement";
import type { StartLimiter } from "@/application/playlists";
import type { Database } from "@/db/client";
import { rateLimits } from "@/db/schema";

export type PgRateLimiterConfig = {
  /** Namespaces the counters, e.g. "lookup:client" or "playlist:start". */
  name: string;
  limit: number;
  windowMs: number;
  /** HMAC secret for stored keys (SESSION_SECRET in production). */
  keySecret: string;
};

export class PgRateLimiter implements RateLimiter {
  constructor(
    private readonly db: Pick<Database, "insert">,
    private readonly config: PgRateLimiterConfig,
  ) {}

  private windowStart(now: Date): Date {
    const { windowMs } = this.config;
    return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  }

  private storedKey(key: string): string {
    return createHmac("sha256", this.config.keySecret)
      .update(`${this.config.name}\u0000${key}`)
      .digest("hex");
  }

  /** True and counts the attempt when `key` is under its limit in the current window. */
  async take(key: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .insert(rateLimits)
      .values({ key: this.storedKey(key), windowStart: this.windowStart(now), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    return (rows[0]?.count ?? 1) <= this.config.limit;
  }

  /** Seconds until the current window ends (when a refused key may try again). */
  retryAfterSeconds(now: Date): number {
    const end = this.windowStart(now).getTime() + this.config.windowMs;
    return Math.max(1, Math.ceil((end - now.getTime()) / 1000));
  }
}

/** The Playlist Engine's start limit (D-036) over a `PgRateLimiter`. */
export class PgStartLimiter implements StartLimiter {
  constructor(
    private readonly limiter: PgRateLimiter,
    private readonly clock: Clock,
  ) {}

  tryTake(key: string): Promise<boolean> {
    return this.limiter.take(key, this.clock.now());
  }

  /** The window is shared by all keys, so this is the time to its end. */
  retryAfterSeconds(): number {
    return this.limiter.retryAfterSeconds(this.clock.now());
  }
}

/** Deletes windows that ended before `before`; returns how many. */
export async function deleteExpiredRateLimits(
  db: Pick<Database, "delete">,
  before: Date,
): Promise<number> {
  const rows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, before))
    .returning({ key: rateLimits.key });
  return rows.length;
}

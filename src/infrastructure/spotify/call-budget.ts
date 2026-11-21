/**
 * D-080: one app-wide Spotify call budget with priorities, shared by every instance through
 * Postgres counters (`rate_limits`). Spotify limits the whole app over a rolling 30 s window
 * (developer docs, "Rate limits"), so every caller draws from one budget:
 *
 * - `build`   user-facing: playlist builds and sign-in. May use the whole app-wide window.
 * - `match`   artist matching and live-lookup validation.          ┐ background: together at
 * - `prewarm` warming the playlist song cache.                     │ most 3 of every 8 calls,
 * - `discovery` gig discovery / ingest validation.                 │ each with its own window
 * - `revalidate` scheduled re-checks.                              ┘ and daily cap.
 *
 * Numbers are deliberately conservative (Spotify publishes none for Development Mode): 8 calls
 * per fixed 10 s window app-wide, so any rolling 30 s holds at most 32 calls (~1 per second).
 * Background classes back off first, which always leaves ≥ 5 of 8 slots for builds.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { and, inArray, like, sql } from "drizzle-orm";
import type { Clock } from "@/application/ports/clock";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import type { Database } from "@/db/client";
import { rateLimits } from "@/db/schema";

export const SPOTIFY_CALL_CLASSES = [
  "build",
  "match",
  "prewarm",
  "discovery",
  "revalidate",
] as const;
export type SpotifyCallClass = (typeof SPOTIFY_CALL_CLASSES)[number];
export type BackgroundClass = Exclude<SpotifyCallClass, "build">;

export const CALL_WINDOW_MS = 10_000;
export const APP_CALLS_PER_WINDOW = 8;
export const BACKGROUND_CALLS_PER_WINDOW = 3;
const DAY_MS = 86_400_000;

export const BACKGROUND_LIMITS: Record<BackgroundClass, { perWindow: number; perDay: number }> = {
  match: { perWindow: 2, perDay: 1_500 },
  // ≤ 1 call per 10 s (well under the "1 per 2 s" ceiling), 1,000 a day.
  prewarm: { perWindow: 1, perDay: 1_000 },
  discovery: { perWindow: 1, perDay: 400 },
  revalidate: { perWindow: 1, perDay: 400 },
};

/** Builds wait at most this long for a slot before returning progress (step budget). */
const BUILD_MAX_WAIT_MS = 1_500;
/** Background callers wait this long for a slot before giving up for now. */
const BACKGROUND_MAX_WAIT_MS = 60_000;

const isBackground = (c: SpotifyCallClass): c is BackgroundClass => c !== "build";

// ── Which class is calling ────────────────────────────────────────────────

const currentClass = new AsyncLocalStorage<SpotifyCallClass>();

/** Runs `fn` with every Spotify call inside it counted as `cls` (scripts, prewarm, auth). */
export function runAsSpotifyClass<T>(cls: SpotifyCallClass, fn: () => Promise<T>): Promise<T> {
  return currentClass.run(cls, fn);
}

export const callClassOr = (fallback: SpotifyCallClass): SpotifyCallClass =>
  currentClass.getStore() ?? fallback;

// ── Counters ──────────────────────────────────────────────────────────────

/** Fixed-window counters shared by every instance. */
export interface CallCounterStore {
  /** Adds 1 to each key in its window and returns the new counts, in order. */
  increment(entries: { key: string; windowStart: Date }[]): Promise<number[]>;
  read(entries: { key: string; windowStart: Date }[]): Promise<number[]>;
}

/** Postgres counters in `rate_limits` (D-070's table); plain keys, they hold no personal data. */
export class PgCallCounterStore implements CallCounterStore {
  constructor(private readonly db: Database) {}

  async increment(entries: { key: string; windowStart: Date }[]): Promise<number[]> {
    const out: number[] = [];
    for (const e of entries) {
      const rows = await this.db
        .insert(rateLimits)
        .values({ key: e.key, windowStart: e.windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimits.key, rateLimits.windowStart],
          set: { count: sql`${rateLimits.count} + 1` },
        })
        .returning({ count: rateLimits.count });
      out.push(rows[0]?.count ?? 1);
    }
    return out;
  }

  async read(entries: { key: string; windowStart: Date }[]): Promise<number[]> {
    if (entries.length === 0) return [];
    const starts = [...new Set(entries.map((e) => e.windowStart.getTime()))].map(
      (t) => new Date(t),
    );
    const rows = await this.db
      .select()
      .from(rateLimits)
      .where(
        and(
          like(rateLimits.key, "spotify:%"),
          inArray(rateLimits.windowStart, starts),
          inArray(
            rateLimits.key,
            entries.map((e) => e.key),
          ),
        ),
      );
    return entries.map(
      (e) =>
        rows.find((r) => r.key === e.key && r.windowStart.getTime() === e.windowStart.getTime())
          ?.count ?? 0,
    );
  }
}

/** For tests and single-process tools. */
export class MemoryCallCounterStore implements CallCounterStore {
  private readonly counts = new Map<string, number>();
  private id = (e: { key: string; windowStart: Date }) => `${e.key}@${e.windowStart.getTime()}`;

  async increment(entries: { key: string; windowStart: Date }[]): Promise<number[]> {
    return entries.map((e) => {
      const n = (this.counts.get(this.id(e)) ?? 0) + 1;
      this.counts.set(this.id(e), n);
      return n;
    });
  }

  async read(entries: { key: string; windowStart: Date }[]): Promise<number[]> {
    return entries.map((e) => this.counts.get(this.id(e)) ?? 0);
  }
}

// ── The budget ────────────────────────────────────────────────────────────

const key = {
  appWindow: "spotify:w:all",
  backgroundWindow: "spotify:w:background",
  classWindow: (c: SpotifyCallClass) => `spotify:w:${c}`,
  classDay: (c: SpotifyCallClass) => `spotify:d:${c}`,
  limitedDay: (c: SpotifyCallClass) => `spotify:d:429:${c}`,
};

export type SpotifyCallStats = Record<SpotifyCallClass, { calls: number; rateLimited: number }>;

export type CallBudgetDeps = {
  store: CallCounterStore;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  logger?: { warn(obj: object, msg: string): void; info?(obj: object, msg: string): void };
};

export class SpotifyCallBudget {
  constructor(private readonly deps: CallBudgetDeps) {}

  private windowStart(now: number, size: number): Date {
    return new Date(Math.floor(now / size) * size);
  }

  /**
   * Takes one call slot for `cls`, waiting for the next window when this one is full.
   * Throws SpotifyBlockedError: `gate_paused` when no slot comes in time (builds retry on their
   * next step), `quota_exceeded` when a background class used its daily cap.
   */
  async acquire(cls: SpotifyCallClass): Promise<void> {
    const started = this.deps.clock.now().getTime();
    const maxWait = isBackground(cls) ? BACKGROUND_MAX_WAIT_MS : BUILD_MAX_WAIT_MS;
    for (;;) {
      const now = this.deps.clock.now().getTime();
      const window = this.windowStart(now, CALL_WINDOW_MS);
      if (isBackground(cls)) await this.assertUnderDailyCap(cls, now);
      if (await this.tryTake(cls, window)) {
        await this.countDay(cls, now);
        return;
      }
      const next = window.getTime() + CALL_WINDOW_MS;
      if (next - started > maxWait) throw new SpotifyBlockedError("gate_paused", new Date(next));
      await this.deps.sleep(next - now);
    }
  }

  /** Reads the window's counters first, so a refused caller doesn't use up anyone's slots. */
  private async tryTake(cls: SpotifyCallClass, windowStart: Date): Promise<boolean> {
    const keys = [key.appWindow, key.backgroundWindow, key.classWindow(cls)];
    const [app, bg, own] = await this.deps.store.read(keys.map((k) => ({ key: k, windowStart })));
    if (!this.allows(cls, app!, bg!, own!)) return false;
    const toCount = isBackground(cls) ? keys : [key.appWindow, key.classWindow(cls)];
    const counts = await this.deps.store.increment(toCount.map((k) => ({ key: k, windowStart })));
    // Two instances may pass the read together; the incremented counts settle it. A refused
    // slot stays counted, which only errs on the quiet side.
    const [app2, bgOrOwn, own2] = counts;
    return isBackground(cls)
      ? this.allows(cls, app2! - 1, bgOrOwn! - 1, own2! - 1)
      : app2! <= APP_CALLS_PER_WINDOW;
  }

  private allows(cls: SpotifyCallClass, app: number, bg: number, own: number): boolean {
    if (app >= APP_CALLS_PER_WINDOW) return false;
    if (!isBackground(cls)) return true;
    return bg < BACKGROUND_CALLS_PER_WINDOW && own < BACKGROUND_LIMITS[cls].perWindow;
  }

  private async assertUnderDailyCap(cls: BackgroundClass, now: number): Promise<void> {
    const day = this.windowStart(now, DAY_MS);
    const [used] = await this.deps.store.read([{ key: key.classDay(cls), windowStart: day }]);
    if (used! >= BACKGROUND_LIMITS[cls].perDay) {
      throw new SpotifyBlockedError("quota_exceeded", new Date(day.getTime() + DAY_MS));
    }
  }

  private async countDay(cls: SpotifyCallClass, now: number): Promise<void> {
    const windowStart = this.windowStart(now, DAY_MS);
    const [n] = await this.deps.store.increment([{ key: key.classDay(cls), windowStart }]);
    if (n! % 100 === 0) this.deps.logger?.info?.({ class: cls, calls: n }, "spotify calls today");
  }

  /** A 429 reached us while `cls` was calling: the shared gate closes for everyone (D-006). */
  async recordRateLimited(cls: SpotifyCallClass, retryAfterSeconds: number | null): Promise<void> {
    const now = this.deps.clock.now().getTime();
    await this.deps.store.increment([
      { key: key.limitedDay(cls), windowStart: this.windowStart(now, DAY_MS) },
    ]);
    this.deps.logger?.warn(
      { class: cls, retryAfterSeconds },
      "spotify 429: the shared gate is closed for every caller",
    );
  }

  /** Calls and 429s per class for the UTC day containing `at` (logged by the sweep). */
  async stats(at: Date): Promise<SpotifyCallStats> {
    const windowStart = this.windowStart(at.getTime(), DAY_MS);
    const entries = SPOTIFY_CALL_CLASSES.flatMap((c) => [
      { key: key.classDay(c), windowStart },
      { key: key.limitedDay(c), windowStart },
    ]);
    const counts = await this.deps.store.read(entries);
    return Object.fromEntries(
      SPOTIFY_CALL_CLASSES.map((c, i) => [
        c,
        { calls: counts[2 * i] ?? 0, rateLimited: counts[2 * i + 1] ?? 0 },
      ]),
    ) as SpotifyCallStats;
  }
}

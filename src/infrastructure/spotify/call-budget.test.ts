import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import {
  APP_CALLS_PER_HOUR,
  APP_CALLS_PER_WINDOW,
  BACKGROUND_CALLS_PER_WINDOW,
  BACKGROUND_LIMITS,
  CALL_WINDOW_MS,
  MemoryCallCounterStore,
  runAsSpotifyClass,
  SpotifyCallBudget,
  type SpotifyCallClass,
} from "./call-budget";
import { SpotifyHttp } from "./spotify-http";
import { FakeClock, fakeSleep, fixedRandom, MemoryGateStore, StaticTokens } from "./test-support";

function budget(clock = new FakeClock()) {
  const { sleep, calls: sleeps } = fakeSleep(clock);
  const warnings: object[] = [];
  const b = new SpotifyCallBudget({
    store: new MemoryCallCounterStore(),
    clock,
    sleep,
    logger: { warn: (o) => void warnings.push(o) },
  });
  return { b, clock, sleeps, warnings };
}

/** How many `acquire` calls per class succeed in one window without waiting. */
async function grabWithoutWaiting(
  b: SpotifyCallBudget,
  clock: FakeClock,
  cls: SpotifyCallClass,
  tries: number,
) {
  const start = clock.now().getTime();
  let got = 0;
  for (let i = 0; i < tries; i++) {
    const before = clock.now().getTime();
    try {
      await b.acquire(cls);
    } catch {
      break;
    }
    if (clock.now().getTime() !== before) break; // had to wait for the next window
    got++;
  }
  clock.ms = start;
  return got;
}

describe("SpotifyCallBudget (D-080)", () => {
  it("caps the app-wide window, and builds may use all of it", async () => {
    const { b, clock } = budget();
    expect(await grabWithoutWaiting(b, clock, "build", 20)).toBe(APP_CALLS_PER_WINDOW);
  });

  it("a background flood can't starve a build", async () => {
    const { b, clock } = budget();
    for (const cls of ["match", "prewarm", "discovery", "revalidate", "match"] as const) {
      await runAsSpotifyClass(cls, async () => {
        await b.acquire(cls).catch(() => undefined);
      });
    }
    // Background got at most its share of this window; builds still get the rest.
    const builds = await grabWithoutWaiting(b, clock, "build", 20);
    expect(builds).toBeGreaterThanOrEqual(APP_CALLS_PER_WINDOW - BACKGROUND_CALLS_PER_WINDOW);
  });

  it("background classes wait for the next window instead of exceeding their share", async () => {
    const { b, clock, sleeps } = budget();
    const window = clock.now().getTime() - (clock.now().getTime() % CALL_WINDOW_MS);
    for (let i = 0; i < 3; i++) await b.acquire("prewarm");
    // ≤ 1 prewarm call per window: the 2nd and 3rd each waited for a new window.
    expect(sleeps).toHaveLength(2);
    expect(clock.now().getTime()).toBeGreaterThanOrEqual(window + 2 * CALL_WINDOW_MS);
  });

  it("holds each background class to its daily cap until the next UTC day", async () => {
    const { b, clock } = budget();
    const cap = BACKGROUND_LIMITS.discovery.perDay;
    for (let i = 0; i < cap; i++) {
      await b.acquire("discovery");
      clock.advance(CALL_WINDOW_MS);
    }
    const err = await b.acquire("discovery").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpotifyBlockedError);
    expect(err).toMatchObject({ reason: "quota_exceeded" });
    const next = (err as SpotifyBlockedError).resumeAfter;
    expect(next.getUTCHours()).toBe(0);
    // Other classes are unaffected, and so is the next day.
    await expect(b.acquire("build")).resolves.toBeUndefined();
    clock.ms = next.getTime();
    await expect(b.acquire("discovery")).resolves.toBeUndefined();
  });

  it("a build that can't get a slot soon returns a short pause instead of blocking a step", async () => {
    const { b, clock } = budget();
    clock.ms = clock.ms - (clock.ms % CALL_WINDOW_MS); // start of a window
    for (let i = 0; i < APP_CALLS_PER_WINDOW; i++) await b.acquire("build");
    const err = await b.acquire("build").catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: "gate_paused" });
    expect((err as SpotifyBlockedError).resumeAfter.getTime() - clock.ms).toBeLessThanOrEqual(
      CALL_WINDOW_MS,
    );
  });

  it("counts calls per class per day", async () => {
    const { b, clock } = budget();
    await b.acquire("build");
    await b.acquire("match");
    clock.advance(CALL_WINDOW_MS);
    await b.acquire("match");
    await b.recordRateLimited("match", 30);
    const stats = await b.stats(clock.now());
    expect(stats.build).toEqual({ calls: 1, rateLimited: 0 });
    expect(stats.match).toEqual({ calls: 2, rateLimited: 1 });
  });
});

describe("a 429 through SpotifyHttp with the budget (D-006, D-080)", () => {
  function client(
    gate: MemoryGateStore,
    b: SpotifyCallBudget,
    clock: FakeClock,
    responses: Response[],
    fetched: string[],
  ) {
    return new SpotifyHttp({
      fetch: async (input) => {
        fetched.push(String(input));
        return responses.shift() ?? Response.json({ ok: true });
      },
      clock,
      random: fixedRandom(),
      sleep: fakeSleep(clock).sleep,
      gate,
      tokens: new StaticTokens(),
      budget: b,
      callClass: "match",
    });
  }

  it("honours a long Retry-After, closes the gate for every class, and records who triggered it", async () => {
    const clock = new FakeClock();
    const gate = new MemoryGateStore();
    const { b, warnings } = budget(clock);
    const fetched: string[] = [];
    const retryAfter = 63_700; // seconds: what Spotify sent on 21 Nov (≈ 17.7 h)
    const http = client(
      gate,
      b,
      clock,
      [new Response("{}", { status: 429, headers: { "Retry-After": String(retryAfter) } })],
      fetched,
    );
    const req = {
      method: "GET" as const,
      path: "/search",
      auth: { kind: "app" as const },
      schema: z.unknown(),
    };

    const err = await runAsSpotifyClass("prewarm", () => http.request(req)).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ reason: "long_retry_after" });
    expect(gate.pausedUntil?.getTime()).toBe(clock.ms + retryAfter * 1000);
    expect(warnings).toContainEqual({ class: "prewarm", retryAfterSeconds: retryAfter });
    expect((await b.stats(clock.now())).prewarm.rateLimited).toBe(1);

    // Every class, builds included, now stops before calling Spotify.
    await expect(runAsSpotifyClass("build", () => http.request(req))).rejects.toMatchObject({
      reason: "gate_paused",
    });
    expect(fetched).toHaveLength(1);
  });
});

describe("app-wide volume caps (2026-11-22 Dev Mode 429)", () => {
  it("refuses every class, builds included, once the hourly cap is used", async () => {
    const { b, clock } = budget();
    let taken = 0;
    for (;;) {
      try {
        await b.acquire("build");
        taken++;
      } catch (e) {
        expect(e).toBeInstanceOf(SpotifyBlockedError);
        expect((e as SpotifyBlockedError).reason).toBe("quota_exceeded");
        break;
      }
      clock.advance(CALL_WINDOW_MS);
      if (taken > APP_CALLS_PER_HOUR + 5) break;
    }
    expect(taken).toBe(APP_CALLS_PER_HOUR);
  });
});

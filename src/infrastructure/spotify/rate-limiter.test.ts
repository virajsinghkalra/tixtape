import { describe, expect, it } from "vitest";
import { SpotifyRateLimiter } from "./rate-limiter";
import { FakeClock, fakeSleep } from "./test-support";

function setup(requestsPerSecond = 3, maxInFlight = 3) {
  const clock = new FakeClock();
  const { sleep, calls } = fakeSleep(clock);
  return {
    clock,
    sleeps: calls,
    limiter: new SpotifyRateLimiter({ requestsPerSecond, maxInFlight }, clock, sleep),
  };
}

describe("SpotifyRateLimiter", () => {
  it("allows a burst of `requestsPerSecond`, then paces the rest", async () => {
    const { limiter, sleeps } = setup(3, 10);
    for (let i = 0; i < 3; i++) (await limiter.acquire())();
    expect(sleeps).toEqual([]);
    (await limiter.acquire())();
    expect(sleeps).toEqual([334]);
  });

  it("refills tokens as time passes", async () => {
    const { limiter, sleeps, clock } = setup(3, 10);
    for (let i = 0; i < 3; i++) (await limiter.acquire())();
    clock.advance(1000);
    for (let i = 0; i < 3; i++) (await limiter.acquire())();
    expect(sleeps).toEqual([]);
  });

  it("caps calls in flight and hands a released slot to the next waiter", async () => {
    const { limiter } = setup(100, 2);
    const a = await limiter.acquire();
    await limiter.acquire();
    let thirdStarted = false;
    const third = limiter.acquire().then((release) => {
      thirdStarted = true;
      return release;
    });
    await Promise.resolve();
    expect(thirdStarted).toBe(false);
    a();
    await third;
    expect(thirdStarted).toBe(true);
    expect(limiter.activeCount).toBe(2);
  });

  it("ignores a second release of the same slot", async () => {
    const { limiter } = setup();
    const release = await limiter.acquire();
    release();
    release();
    expect(limiter.activeCount).toBe(0);
  });

  it("rejects nonsense configuration", () => {
    const clock = new FakeClock();
    expect(
      () => new SpotifyRateLimiter({ requestsPerSecond: 0, maxInFlight: 1 }, clock, async () => {}),
    ).toThrow();
    expect(
      () => new SpotifyRateLimiter({ requestsPerSecond: 1, maxInFlight: 0 }, clock, async () => {}),
    ).toThrow();
  });
});

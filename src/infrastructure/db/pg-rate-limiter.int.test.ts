import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { rateLimits } from "@/db/schema";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { deleteExpiredRateLimits, PgRateLimiter, PgStartLimiter } from "./pg-rate-limiter";

const db = testDb();
const T0 = new Date("2026-11-21T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const limiter = (name = "lookup:client", limit = 3) =>
  new PgRateLimiter(db, { name, limit, windowMs: 60_000, keySecret: "test-secret" });

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgRateLimiter", () => {
  it("allows `limit` takes per window, then refuses until the next window", async () => {
    const l = limiter();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await l.take("203.0.113.7", at(i * 1_000)));
    expect(results).toEqual([true, true, true, false]);
    await expect(l.take("203.0.113.7", at(60_000))).resolves.toBe(true);
  });

  it("is shared across instances (one counter in Postgres)", async () => {
    const a = limiter();
    const b = limiter();
    await a.take("k", T0);
    await b.take("k", T0);
    await a.take("k", T0);
    await expect(b.take("k", T0)).resolves.toBe(false);
  });

  it("counts concurrent takes exactly", async () => {
    const l = limiter("burst", 5);
    const results = await Promise.all(Array.from({ length: 20 }, () => l.take("k", T0)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("keeps clients and limit names apart, and never stores the raw key", async () => {
    await limiter("a", 1).take("203.0.113.7", T0);
    await expect(limiter("a", 1).take("198.51.100.1", T0)).resolves.toBe(true);
    await expect(limiter("b", 1).take("203.0.113.7", T0)).resolves.toBe(true);
    const rows = await db.select().from(rateLimits);
    expect(rows.some((r) => r.key.includes("203.0.113.7"))).toBe(false);
  });

  it("reports seconds to the end of the window", () => {
    expect(limiter().retryAfterSeconds(at(15_000))).toBe(45);
  });

  it("deletes windows that ended", async () => {
    await limiter().take("k", T0);
    await limiter().take("k", at(120_000));
    await expect(deleteExpiredRateLimits(db, at(60_000))).resolves.toBe(1);
  });

  it("backs the playlist start limit (StartLimiter)", async () => {
    let now = at(15_000);
    const start = new PgStartLimiter(limiter("playlist:start", 1), { now: () => now });
    await expect(start.tryTake("ip")).resolves.toBe(true);
    await expect(start.tryTake("ip")).resolves.toBe(false);
    expect(start.retryAfterSeconds()).toBe(45);
    now = at(60_000);
    await expect(start.tryTake("ip")).resolves.toBe(true);
  });
});

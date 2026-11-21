import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AUTO_PUBLISH_PAUSED_UNTIL } from "@/application/ports/auto-publish";
import { settings } from "@/db/schema";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgAutoPublishPause } from "./auto-publish-pause";

const db = testDb();
const pause = new PgAutoPublishPause(db);
const NOW = new Date("2026-11-21T12:00:00Z");
const later = new Date("2026-11-22T12:00:00Z");

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgAutoPublishPause", () => {
  it("is not paused by default", async () => {
    await expect(pause.pausedUntil(NOW)).resolves.toBeNull();
  });

  it("pauses until a time, upserts on repeat, and resumes", async () => {
    await pause.pauseUntil(NOW, "first");
    await pause.pauseUntil(later, "spike: 31 in 24h");
    await expect(pause.pausedUntil(NOW)).resolves.toEqual(later);
    expect(await db.select().from(settings)).toHaveLength(1);
    await pause.resume();
    await expect(pause.pausedUntil(NOW)).resolves.toBeNull();
  });

  it("treats a pause that has ended as not paused", async () => {
    await pause.pauseUntil(later, "x");
    await expect(pause.pausedUntil(new Date("2026-11-23T00:00:00Z"))).resolves.toBeNull();
  });

  it("fails safe (paused) when the stored value is unreadable", async () => {
    await db.insert(settings).values({ key: AUTO_PUBLISH_PAUSED_UNTIL, value: { until: "soon" } });
    const until = await pause.pausedUntil(NOW);
    expect(until !== null && until > NOW).toBe(true);
  });
});

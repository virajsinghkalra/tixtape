import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { artists, events, ingestRuns, playlistJobs } from "@/db/schema";
import { asEventId, asPlaylistJobId, type EventId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgAdminConsoleRepository } from "./admin-console-repository";
import { PgPlaylistJobRepository } from "./playlist-job-repository";

const db = testDb();
const repo = new PgAdminConsoleRepository(db);
const jobs = new PgPlaylistJobRepository(db);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function newEvent(
  key: string,
  visibility: "held" | "published" | "archived" = "held",
  verification: unknown = null,
): Promise<EventId> {
  const rows = await db
    .insert(events)
    .values({
      title: `Show ${key}`,
      type: "concert",
      startsAt: new Date("2026-12-18T13:30:00Z"),
      dedupeKey: key,
      visibility,
      verification,
    })
    .returning({ id: events.id });
  return asEventId(rows[0]!.id);
}

describe("PgAdminConsoleRepository", () => {
  it("counts events by visibility, with zeros for empty ones", async () => {
    await newEvent("a", "held");
    await newEvent("b", "held");
    await newEvent("c", "published");
    await expect(repo.countEventsByVisibility()).resolves.toEqual({
      held: 2,
      published: 1,
      archived: 0,
    });
  });

  it("counts artists needing review", async () => {
    await db.insert(artists).values([
      { name: "A", normalizedName: "a", matchStatus: "needs_review" },
      { name: "B", normalizedName: "b", matchStatus: "auto" },
      { name: "C", normalizedName: "c", matchStatus: "needs_review" },
    ]);
    await expect(repo.countArtistsNeedingReview()).resolves.toBe(2);
  });

  it("returns the newest ingest run per source", async () => {
    await db.insert(ingestRuns).values([
      {
        source: "sunburn",
        startedAt: new Date("2026-11-20T00:00:00Z"),
        status: "failed",
        error: "boom",
      },
      {
        source: "sunburn",
        startedAt: new Date("2026-11-21T00:00:00Z"),
        status: "succeeded",
        itemsSeen: 4,
        itemsNew: 1,
      },
      {
        source: "wikipedia",
        startedAt: new Date("2026-11-19T00:00:00Z"),
        status: "failed",
        error: "403",
      },
    ]);
    const runs = await repo.latestIngestRuns();
    expect(runs.map((r) => [r.source, r.status, r.itemsSeen, r.error])).toEqual([
      ["sunburn", "succeeded", 4, null],
      ["wikipedia", "failed", 0, "403"],
    ]);
  });

  it("lists jobs newest first with the event title, filtered by status, and counts them", async () => {
    const e1 = await newEvent("a");
    const e2 = await newEvent("b");
    const first = (await jobs.createShared(e1))!;
    const second = (await jobs.createShared(e2))!;
    await db
      .update(playlistJobs)
      .set({ status: "succeeded", createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(playlistJobs.id, first.id));

    const all = await repo.listJobs({ statuses: null, limit: 10 });
    expect(all.map((j) => [j.id, j.eventTitle, j.status])).toEqual([
      [second.id, "Show b", "queued"],
      [first.id, "Show a", "succeeded"],
    ]);
    const active = await repo.listJobs({ statuses: ["queued", "running", "paused"], limit: 10 });
    expect(active.map((j) => j.id)).toEqual([second.id]);
    await expect(repo.listJobs({ statuses: null, limit: 1 })).resolves.toHaveLength(1);
    await expect(repo.countJobsByStatus()).resolves.toEqual({
      queued: 1,
      running: 0,
      paused: 0,
      succeeded: 1,
      partial: 0,
      failed: 0,
    });
  });

  it("reads the verification column: undefined for no event, null when never verified", async () => {
    const plain = await newEvent("a");
    const checked = await newEvent("b", "held", { confidence: 0.9 });
    await expect(repo.findEventVerification(plain)).resolves.toBeNull();
    await expect(repo.findEventVerification(checked)).resolves.toEqual({ confidence: 0.9 });
    await expect(
      repo.findEventVerification(asEventId("00000000-0000-4000-8000-000000000000")),
    ).resolves.toBeUndefined();
  });

  it("cancels an active job; the step holding its lease can no longer write", async () => {
    const job = (await jobs.createShared(await newEvent("a")))!;
    const claimed = (await jobs.claim(job.id, 60_000))!;

    await expect(repo.failActiveJob(job.id, "Stopped.")).resolves.toBe("cancelled");
    const row = (await db.select().from(playlistJobs).where(eq(playlistJobs.id, job.id)))[0]!;
    expect(row).toMatchObject({
      status: "failed",
      error: "Stopped.",
      lockedUntil: null,
      resumeAfter: null,
    });

    // The in-flight step's lease no longer matches, and the job isn't active: no revival.
    await expect(jobs.save(claimed.lease, { status: "running", progress: 50 })).resolves.toBe(
      false,
    );
    await expect(jobs.claim(job.id, 60_000)).resolves.toBeNull();
    // A new shared build for the event may start again.
    await expect(jobs.createShared(job.eventId)).resolves.not.toBeNull();
  });

  it("reports finished and unknown jobs without changing them", async () => {
    const job = (await jobs.createShared(await newEvent("a")))!;
    await db.update(playlistJobs).set({ status: "succeeded" }).where(eq(playlistJobs.id, job.id));
    await expect(repo.failActiveJob(job.id, "Stopped.")).resolves.toBe("not_active");
    const row = (await db.select().from(playlistJobs).where(eq(playlistJobs.id, job.id)))[0]!;
    expect(row).toMatchObject({ status: "succeeded", error: null });
    await expect(
      repo.failActiveJob(asPlaylistJobId("00000000-0000-4000-8000-000000000000"), "x"),
    ).resolves.toBe("not_found");
  });
});

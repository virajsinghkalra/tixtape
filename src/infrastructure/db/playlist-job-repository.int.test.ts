import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { JobCheckpoint } from "@/application/ports/playlists";
import { events, playlistJobs } from "@/db/schema";
import { asEventId, asPlaylistJobId, asSpotifyTrackId, type EventId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgPlaylistJobRepository } from "./playlist-job-repository";

const db = testDb();
const repo = new PgPlaylistJobRepository(db);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function newEvent(key = "e1"): Promise<EventId> {
  const rows = await db
    .insert(events)
    .values({ title: "Show", type: "concert", startsAt: new Date(), dedupeKey: key })
    .returning({ id: events.id });
  return asEventId(rows[0]!.id);
}

const checkpoint: JobCheckpoint = {
  stage: "write",
  lineupHash: "h",
  artistIndex: 2,
  picks: [[{ id: asSpotifyTrackId("t1"), isrc: "INX", key: "song|a" }], []],
  unresolved: ["Nobody"],
  pickedTrackIds: [asSpotifyTrackId("t1")],
  playlistId: null,
  playlistUrl: null,
  chunksDone: 0,
  chunkInFlight: 0,
  snapshotId: null,
  popularity: [120_000, null],
  pool: null,
};

describe("PgPlaylistJobRepository", () => {
  it("creates one active shared job per event; a concurrent create gets null", async () => {
    const eventId = await newEvent();
    const others = [testDb(), testDb()];
    try {
      const results = await Promise.all(
        [repo, ...others.map((d) => new PgPlaylistJobRepository(d))].map((r) =>
          r.createShared(eventId),
        ),
      );
      const created = results.filter((r) => r !== null);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        eventId,
        status: "queued",
        progress: 0,
        checkpoint: null,
      });
      await expect(repo.findActiveShared(eventId)).resolves.toEqual(created[0]);
    } finally {
      await Promise.all(others.map((d) => d.$close()));
    }
  });

  it("allows a new job once the previous one finished", async () => {
    const eventId = await newEvent();
    const first = (await repo.createShared(eventId))!;
    const claimed = (await repo.claim(first.id, 15_000))!;
    await repo.save(claimed.lease, { status: "failed", error: "x" });
    await expect(repo.findActiveShared(eventId)).resolves.toBeNull();
    await expect(repo.createShared(eventId)).resolves.toMatchObject({ status: "queued" });
  });

  it("claims with a lease that excludes other steps until released or expired", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    const a = await repo.claim(job.id, 15_000);
    expect(a).not.toBeNull();
    await expect(repo.claim(job.id, 15_000)).resolves.toBeNull();
    await repo.release(a!.lease);
    const b = await repo.claim(job.id, 15_000);
    expect(b).not.toBeNull();
    // Expire it: a killed step's lease runs out.
    await db
      .update(playlistJobs)
      .set({ lockedUntil: sql`now() - interval '1 second'` })
      .where(eq(playlistJobs.id, job.id));
    await expect(repo.claim(job.id, 15_000)).resolves.not.toBeNull();
    // The expired lease can no longer write.
    await expect(repo.save(b!.lease, { progress: 50 })).resolves.toBe(false);
  });

  it("only one of many concurrent claims wins", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    const others = [testDb(), testDb(), testDb()];
    try {
      const claims = await Promise.all(
        others.map((d) => new PgPlaylistJobRepository(d).claim(job.id, 15_000)),
      );
      expect(claims.filter((c) => c !== null)).toHaveLength(1);
    } finally {
      await Promise.all(others.map((d) => d.$close()));
    }
  });

  it("saves updates and round-trips the checkpoint while the lease is held", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    const { lease } = (await repo.claim(job.id, 15_000))!;
    const resumeAfter = new Date("2026-11-21T10:00:30.000Z");
    await expect(
      repo.save(lease, {
        status: "running",
        stage: "write",
        progress: 85,
        artistsDone: 2,
        artistsTotal: 2,
        checkpoint,
        resumeAfter,
      }),
    ).resolves.toBe(true);
    await expect(repo.findById(job.id)).resolves.toMatchObject({
      status: "running",
      stage: "write",
      progress: 85,
      artistsDone: 2,
      checkpoint,
      resumeAfter,
    });
  });

  it("does not claim finished jobs and reads unknown ids as null", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    const { lease } = (await repo.claim(job.id, 15_000))!;
    await repo.save(lease, { status: "succeeded" });
    await repo.release(lease);
    await expect(repo.claim(job.id, 15_000)).resolves.toBeNull();
    const missing = asPlaylistJobId("00000000-0000-4000-8000-000000000000");
    await expect(repo.findById(missing)).resolves.toBeNull();
    await expect(repo.claim(missing, 15_000)).resolves.toBeNull();
  });

  it("never writes to a job an admin cancelled while a step held it", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    const { lease } = (await repo.claim(job.id, 15_000))!;
    await db.update(playlistJobs).set({ status: "failed" }).where(eq(playlistJobs.id, job.id));
    await expect(repo.save(lease, { status: "running", progress: 30 })).resolves.toBe(false);
    await expect(repo.findById(job.id)).resolves.toMatchObject({ status: "failed", progress: 0 });
    await repo.release(lease);
    await expect(repo.claim(job.id, 15_000)).resolves.toBeNull();
  });

  it("treats a checkpoint it can't parse as no checkpoint", async () => {
    const job = (await repo.createShared(await newEvent()))!;
    await db
      .update(playlistJobs)
      .set({ checkpoint: { stage: "mystery" } })
      .where(eq(playlistJobs.id, job.id));
    await expect(repo.findById(job.id)).resolves.toMatchObject({ checkpoint: null });
  });
});

import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { JobStatus } from "@/application/ports/playlists";
import { events, playlistJobs } from "@/db/schema";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { DUE_IDLE_MS, PgPlaylistJobRepository } from "./playlist-job-repository";

const db = testDb();
const repo = new PgPlaylistJobRepository(db);
const NOW = new Date("2026-11-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

let n = 0;
/** One event with one shared job in the given state. */
async function job(state: {
  status: JobStatus;
  updatedAt?: Date;
  resumeAfter?: Date | null;
  lockedUntil?: Date | null;
}): Promise<{ eventId: EventId; id: string }> {
  const [e] = await db
    .insert(events)
    .values({ title: "Show", type: "concert", startsAt: NOW, dedupeKey: `due-${++n}` })
    .returning({ id: events.id });
  const eventId = asEventId(e!.id);
  const created = await repo.createShared(eventId);
  await db
    .update(playlistJobs)
    .set({
      status: state.status,
      updatedAt: state.updatedAt ?? ago(DUE_IDLE_MS + 1_000),
      resumeAfter: state.resumeAfter ?? null,
      lockedUntil: state.lockedUntil ?? null,
    })
    .where(eq(playlistJobs.id, created!.id));
  return { eventId, id: created!.id };
}

describe("PgPlaylistJobRepository.listDue", () => {
  it("lists idle active jobs whose resume time has passed, oldest first", async () => {
    const queued = await job({ status: "queued", updatedAt: ago(10 * 60_000) });
    const running = await job({ status: "running", updatedAt: ago(5 * 60_000) });
    const resumed = await job({ status: "paused", resumeAfter: ago(1_000) });

    const due = await repo.listDue(NOW, 10);
    expect(due.map((j) => j.id)).toEqual([queued.id, running.id, resumed.id]);
  });

  it("skips finished, still-paused, leased and recently stepped jobs", async () => {
    await job({ status: "succeeded" });
    await job({ status: "failed" });
    await job({ status: "paused", resumeAfter: later(60_000) });
    await job({ status: "running", lockedUntil: later(10_000) });
    await job({ status: "running", updatedAt: ago(30_000) });

    await expect(repo.listDue(NOW, 10)).resolves.toEqual([]);
  });

  it("returns at most `limit` jobs", async () => {
    for (let i = 0; i < 3; i++) await job({ status: "running" });
    await expect(repo.listDue(NOW, 2)).resolves.toHaveLength(2);
  });
});

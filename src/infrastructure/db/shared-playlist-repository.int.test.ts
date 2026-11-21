import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema";
import { asEventId, asSpotifyPlaylistId, type EventId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgSharedPlaylistRepository } from "./shared-playlist-repository";

const db = testDb();
const repo = new PgSharedPlaylistRepository(db);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function newEvent(key = "e1"): Promise<EventId> {
  const rows = await db
    .insert(events)
    .values({ title: "Show", type: "concert", startsAt: new Date(), dedupeKey: key })
    .returning({ id: events.id });
  return asEventId(rows[0]!.id);
}

const pl = (id: string) => ({
  spotifyPlaylistId: asSpotifyPlaylistId(id),
  url: `https://open.spotify.com/playlist/${id}`,
});

describe("PgSharedPlaylistRepository", () => {
  it("saves a created playlist with no tracks and no build hash yet", async () => {
    const eventId = await newEvent();
    await expect(repo.findByEvent(eventId)).resolves.toBeNull();
    const row = await repo.saveCreated(eventId, pl("pl1"));
    expect(row).toMatchObject({
      eventId,
      ...pl("pl1"),
      trackIds: [],
      snapshotId: null,
      lineupHashAtBuild: null,
    });
    await expect(repo.findByEvent(eventId)).resolves.toEqual(row);
  });

  it("keeps the first playlist when a second one is saved for the same event", async () => {
    const eventId = await newEvent();
    await repo.saveCreated(eventId, pl("pl1"));
    await expect(repo.saveCreated(eventId, pl("pl2"))).resolves.toMatchObject(pl("pl1"));
  });

  it("refuses one Spotify playlist for two events", async () => {
    await repo.saveCreated(await newEvent("a"), pl("pl1"));
    await expect(repo.saveCreated(await newEvent("b"), pl("pl1"))).rejects.toThrow();
  });

  it("marks a build", async () => {
    const eventId = await newEvent();
    await repo.saveCreated(eventId, pl("pl1"));
    const at = new Date("2026-11-21T10:00:00.000Z");
    await repo.markBuilt(eventId, { trackIds: ["t1", "t2"], snapshotId: "s", lineupHash: "h", at });
    await expect(repo.findByEvent(eventId)).resolves.toMatchObject({
      trackIds: ["t1", "t2"],
      snapshotId: "s",
      lineupHashAtBuild: "h",
      builtAt: at,
    });
  });
});

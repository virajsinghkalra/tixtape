import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  events,
  playlistJobs,
  playlists,
  sessions,
  spotifyTokens,
  users as usersTable,
} from "@/db/schema";
import { TokenCipher } from "@/infrastructure/crypto/token-cipher";
import { PgSessionRepository } from "./session-repository";
import { PgSpotifyTokenRepository } from "./spotify-token-repository";
import { asUserId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgUserRepository } from "./user-repository";

const db = testDb();
const users = new PgUserRepository(db);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgUserRepository", () => {
  it("creates a user with the default market", async () => {
    const user = await users.upsertBySpotifyId({
      spotifyUserId: "sp1",
      displayName: "Ada",
      role: "user",
    });
    expect(user).toMatchObject({
      spotifyUserId: "sp1",
      displayName: "Ada",
      market: "IN",
      role: "user",
    });
    await expect(users.findById(user.id)).resolves.toEqual(user);
  });

  it("updates name and role on the next login, keeping id and market", async () => {
    const first = await users.upsertBySpotifyId({
      spotifyUserId: "sp1",
      displayName: "Ada",
      role: "user",
    });
    await db.update(usersTable).set({ market: "US" }).where(eq(usersTable.id, first.id));
    const second = await users.upsertBySpotifyId({
      spotifyUserId: "sp1",
      displayName: null,
      role: "admin",
    });
    expect(second).toEqual({ ...first, displayName: null, role: "admin", market: "US" });
  });

  it("returns null for an unknown id", async () => {
    await expect(
      users.findById(asUserId("00000000-0000-0000-0000-000000000000")),
    ).resolves.toBeNull();
  });

  it("delete removes the user and cascades tokens, sessions, playlists and jobs", async () => {
    const user = await users.upsertBySpotifyId({
      spotifyUserId: "sp1",
      displayName: null,
      role: "user",
    });
    const other = await users.upsertBySpotifyId({
      spotifyUserId: "sp2",
      displayName: null,
      role: "user",
    });
    const cipher = new TokenCipher({ 1: randomBytes(32).toString("base64") }, 1);
    const tokenSet = {
      accessToken: "a",
      refreshToken: "r",
      scope: "s",
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    for (const u of [user, other]) {
      await new PgSpotifyTokenRepository(db, cipher).save(u.id, tokenSet);
      await new PgSessionRepository(db).create(`sid-${u.id}`, u.id, new Date(Date.now() + 60_000));
    }
    const [event] = await db
      .insert(events)
      .values({ title: "Fest", type: "festival", startsAt: new Date(), dedupeKey: "fest" })
      .returning();
    const [playlist] = await db
      .insert(playlists)
      .values({
        userId: user.id,
        eventId: event!.id,
        optionsHash: "h",
        spotifyPlaylistId: "pl1",
        trackIds: [],
      })
      .returning();
    await db.insert(playlistJobs).values({
      idempotencyKey: "k",
      kind: "personal",
      userId: user.id,
      eventId: event!.id,
      options: {},
      playlistId: playlist!.id,
    });

    await users.delete(user.id);

    await expect(users.findById(user.id)).resolves.toBeNull();
    for (const table of [spotifyTokens, sessions]) {
      const rows = await db.select({ userId: table.userId }).from(table);
      expect(rows.map((r) => r.userId)).toEqual([other.id]);
    }
    await expect(db.select().from(playlists)).resolves.toEqual([]);
    await expect(db.select().from(playlistJobs)).resolves.toEqual([]);
    await expect(db.select().from(events)).resolves.toHaveLength(1);
  });
});

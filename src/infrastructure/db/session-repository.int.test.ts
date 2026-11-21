import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sessions as sessionsTable } from "@/db/schema";
import type { UserId } from "@/domain/shared/ids";
import { hashSessionId } from "@/infrastructure/crypto/session-id";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgSessionRepository } from "./session-repository";
import { PgUserRepository } from "./user-repository";

const db = testDb();
const sessions = new PgSessionRepository(db);
const now = new Date(Date.UTC(2026, 10, 21));
const later = (ms: number) => new Date(now.getTime() + ms);

let userId: UserId;
beforeEach(async () => {
  await truncateAll(db);
  userId = (
    await new PgUserRepository(db).upsertBySpotifyId({
      spotifyUserId: "sp1",
      displayName: null,
      role: "user",
    })
  ).id;
});
afterAll(() => db.$close());

describe("PgSessionRepository", () => {
  it("stores only the SHA-256 of the session id", async () => {
    await sessions.create("raw-session-id", userId, later(1000));
    const rows = await db.select().from(sessionsTable);
    expect(rows.map((r) => r.idHash)).toEqual([hashSessionId("raw-session-id")]);
    expect(rows[0]?.idHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("finds the user until the session expires", async () => {
    await sessions.create("sid", userId, later(1000));
    await expect(sessions.findUserId("sid", now)).resolves.toBe(userId);
    await expect(sessions.findUserId("sid", later(1000))).resolves.toBeNull();
    await expect(sessions.findUserId("other", now)).resolves.toBeNull();
  });

  it("does not accept the stored hash as a session id", async () => {
    await sessions.create("sid", userId, later(1000));
    await expect(sessions.findUserId(hashSessionId("sid"), now)).resolves.toBeNull();
  });

  it("deletes a session", async () => {
    await sessions.create("sid", userId, later(1000));
    await sessions.delete("sid");
    await expect(sessions.findUserId("sid", now)).resolves.toBeNull();
  });

  it("returns the timestamps for the idle timeout and honours a given created_at", async () => {
    await sessions.create("sid", userId, later(1000), now);
    await expect(sessions.find("sid", now)).resolves.toEqual({
      userId,
      expiresAt: later(1000),
      createdAt: now,
    });
    await expect(sessions.find("sid", later(1000))).resolves.toBeNull();
  });

  it("extends a session's expiry", async () => {
    await sessions.create("sid", userId, later(1000));
    await sessions.extend("sid", later(5000));
    await expect(sessions.findUserId("sid", later(4000))).resolves.toBe(userId);
  });

  it("deletes only expired sessions", async () => {
    await sessions.create("old", userId, later(-1));
    await sessions.create("edge", userId, now);
    await sessions.create("live", userId, later(1000));
    await expect(sessions.deleteExpired(now)).resolves.toBe(2);
    const left = await db.select().from(sessionsTable);
    expect(left.map((r) => r.idHash)).toEqual([hashSessionId("live")]);
  });
});

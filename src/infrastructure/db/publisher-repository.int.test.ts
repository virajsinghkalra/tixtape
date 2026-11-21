import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { asUserId } from "@/domain/shared/ids";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgPublisherRepository } from "./publisher-repository";

const db = testDb();

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgPublisherRepository", () => {
  const publisher = new PgPublisherRepository(db);
  const newUser = async (spotifyUserId: string) =>
    asUserId((await db.insert(users).values({ spotifyUserId }).returning({ id: users.id }))[0]!.id);

  it("keeps a single row and replaces the publisher", async () => {
    await expect(publisher.find()).resolves.toBeNull();
    const a = await newUser("a");
    const b = await newUser("b");
    const t1 = new Date("2026-11-21T10:00:00.000Z");
    const t2 = new Date("2026-11-22T10:00:00.000Z");
    await publisher.set(a, t1);
    await expect(publisher.find()).resolves.toEqual({ userId: a, connectedAt: t1 });
    await publisher.set(b, t2);
    await expect(publisher.find()).resolves.toEqual({ userId: b, connectedAt: t2 });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgSpotifyGateStore } from "./spotify-gate-store";

const db = testDb();
const store = new PgSpotifyGateStore(db);
const at = (s: number) => new Date(Date.UTC(2026, 10, 21, 12, 0, s));

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgSpotifyGateStore", () => {
  it("reads null before any pause", async () => {
    await expect(store.readPausedUntil()).resolves.toBeNull();
  });

  it("creates the single row and keeps the later deadline", async () => {
    await expect(store.extendPausedUntil(at(10))).resolves.toEqual(at(10));
    await expect(store.extendPausedUntil(at(5))).resolves.toEqual(at(10));
    await expect(store.extendPausedUntil(at(20))).resolves.toEqual(at(20));
    await expect(store.readPausedUntil()).resolves.toEqual(at(20));
  });

  it("is atomic under concurrent writers from separate connections", async () => {
    const others = [testDb(), testDb(), testDb()];
    try {
      const writers = others.map((d) => new PgSpotifyGateStore(d));
      await Promise.all(
        [7, 3, 30, 12, 25, 1].map((s, i) => writers[i % writers.length]!.extendPausedUntil(at(s))),
      );
      await expect(store.readPausedUntil()).resolves.toEqual(at(30));
    } finally {
      await Promise.all(others.map((d) => d.$close()));
    }
  });
});

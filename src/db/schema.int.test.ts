import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { testDb } from "../../tests/setup/db";

const db = testDb();
afterAll(() => db.$close());

describe("database schema", () => {
  it("applies every migration and creates the LLD tables", async () => {
    const rows = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of [
      "events",
      "artists",
      "event_artists",
      "playlist_jobs",
      "spotify_gate",
      "spotify_tokens",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("allows only one spotify_gate row", async () => {
    await expect(db.execute(sql`INSERT INTO spotify_gate (id) VALUES (2)`)).rejects.toThrow();
  });
});

/** Helpers for integration tests. Each test file truncates what it touches. */
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://app:app@127.0.0.1:54329/${process.env.TEST_DB_NAME ?? "concert_test"}`;

export function testDb(): Database {
  return createDb(TEST_DATABASE_URL);
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(sql`
    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;`);
}

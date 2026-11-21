/**
 * Integration tests run against a real Postgres (docker compose, `npm run db:up`).
 * Each run gets a fresh database, migrated once. Teams working in parallel MUST set their own
 * TEST_DB_NAME (e.g. TEST_DB_NAME=concert_test_matching) so they never drop each other's DB.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert";
const DB_NAME = process.env.TEST_DB_NAME ?? "concert_test";
if (!/^[a-z0-9_]+$/.test(DB_NAME)) throw new Error(`Unsafe TEST_DB_NAME: ${DB_NAME}`);
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://app:app@127.0.0.1:54329/${DB_NAME}`;

export default async function setup(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
}

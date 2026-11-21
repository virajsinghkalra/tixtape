/**
 * D-049: give E2E tests their own database (concert_e2e), freshly migrated and seeded with
 * fixture events. Never touches the developer's real local database.
 */
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert";
const E2E_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert_e2e";

export default async function globalSetup(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe("DROP DATABASE IF EXISTS concert_e2e WITH (FORCE)");
  await admin.unsafe("CREATE DATABASE concert_e2e");
  await admin.end();

  const client = postgres(E2E_URL, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();

  // Seed in a tsx child process: Playwright's loader can't resolve the app's "@/" alias.
  execFileSync("npx", ["tsx", "tests/e2e/fixtures/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: E2E_URL },
  });
}

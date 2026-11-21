import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

async function main(): Promise<void> {
  const db = createDb();
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.$close();
  console.warn("Migrations applied.");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

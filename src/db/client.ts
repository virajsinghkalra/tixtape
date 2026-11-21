import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env, isVercel } from "@/lib/env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string = env().DATABASE_URL) {
  // Serverless-friendly: small pool, short idle timeout (Neon free tier). Each Vercel function
  // instance has its own pool, so keep it tiny there and let Neon's pooler fan in (D-070).
  const max = env().DB_POOL_MAX ?? (isVercel() ? 2 : 5);
  const client = postgres(url, { max, idle_timeout: 20, prepare: false });
  return Object.assign(drizzle(client, { schema }), { $close: () => client.end() });
}

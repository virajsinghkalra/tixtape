/**
 * D-084: a cheap uptime probe. Pings Postgres with `select 1` under a short timeout and reports
 * only "ok" or "down": no versions, hosts, error text or secrets.
 */
import { sql } from "drizzle-orm";
import { withTimeout } from "@/lib/timeout";
import { container } from "@/server/container";

export type Health = { status: "ok" | "degraded"; db: "ok" | "down"; dbMs: number | null };

export const DB_PING_TIMEOUT_MS = 2500;

export async function checkHealth(
  ping: () => Promise<unknown> = () => container().db.execute(sql`select 1`),
  now: () => number = Date.now,
): Promise<Health> {
  const started = now();
  const ok = await withTimeout(
    Promise.resolve()
      .then(ping)
      .then(() => true),
    DB_PING_TIMEOUT_MS,
    false,
  );
  return ok
    ? { status: "ok", db: "ok", dbMs: now() - started }
    : { status: "degraded", db: "down", dbMs: null };
}

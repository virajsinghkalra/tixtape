import { tracingChannel } from "node:diagnostics_channel";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env, isVercel } from "@/lib/env";
import { spanStart } from "@/lib/server-timing";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string = env().DATABASE_URL) {
  // Serverless-friendly: small pool, short idle timeout (Neon free tier). Each Vercel function
  // instance has its own pool, so keep it tiny there and let Neon's pooler fan in (D-070).
  const max = env().DB_POOL_MAX ?? (isVercel() ? 2 : 5);
  const client = postgres(url, { max, idle_timeout: 20, prepare: false });
  timeQueries();
  return Object.assign(drizzle(client, { schema }), { $close: () => client.end() });
}

/**
 * D-086: postgres.js publishes every query and connection open on `diagnostics_channel`. Each
 * one becomes a `db` / `db-connect` span of the request it started in (`Server-Timing`).
 * Subscribed once per process; a no-op outside a timed request.
 */
function timeQueries(): void {
  const flag = globalThis as typeof globalThis & { __dbTimingOn?: boolean };
  if (flag.__dbTimingOn) return;
  flag.__dbTimingOn = true;
  for (const [channel, span] of [
    ["postgres:query", "db"],
    ["postgres:connect", "db-connect"],
  ] as const) {
    const open = new WeakMap<object, () => void>();
    tracingChannel(channel).subscribe({
      start: (ctx) => void open.set(ctx as object, spanStart(span)),
      end: () => {},
      asyncStart: () => {},
      asyncEnd: (ctx) => {
        open.get(ctx as object)?.();
        open.delete(ctx as object);
      },
      error: () => {},
    });
  }
}

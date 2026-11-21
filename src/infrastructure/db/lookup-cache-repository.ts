/**
 * Live lookup answers cached in Postgres (D-070), so a repeat or a poll on another
 * serverless instance answers without redoing the work. Table (proposed, owned by the Lead):
 *
 *   CREATE TABLE lookup_cache (
 *     lookup_id  text PRIMARY KEY,
 *     query_key  text NOT NULL,
 *     response   jsonb NOT NULL,
 *     expires_at timestamptz NOT NULL,
 *     created_at timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX lookup_cache_expires_idx ON lookup_cache (expires_at);
 *
 * Until the table exists, reads miss and writes are skipped (one warning per process).
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { LookupCache, LookupResponse } from "@/application/ingestion/live-lookup";
import type { Database } from "@/db/client";
import type { Logger } from "@/lib/logger";

const ResponseSchema = z.union([
  z.object({ status: z.literal("found"), results: z.array(z.unknown()) }),
  z.object({
    status: z.literal("not_found"),
    artist: z.unknown().optional(),
    artists: z.array(z.unknown()).optional(),
    ambiguous: z.boolean().optional(),
  }),
]);

const isMissingTable = (e: unknown): boolean => {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 5; depth++) {
    if ((cur as { code?: unknown }).code === "42P01") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
};

export class PgLookupCache implements LookupCache {
  private missing = false;

  constructor(
    private readonly db: Database,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  async get(lookupId: string, now: Date): Promise<LookupResponse | null> {
    if (this.missing) return null;
    try {
      const rows = await this.db.execute<{ response: unknown }>(sql`
        SELECT response FROM lookup_cache
        WHERE lookup_id = ${lookupId} AND expires_at > ${now.toISOString()}::timestamptz`);
      const parsed = ResponseSchema.safeParse(rows[0]?.response);
      return parsed.success ? (parsed.data as LookupResponse) : null;
    } catch (e) {
      return this.onError(e);
    }
  }

  async set(entry: {
    lookupId: string;
    queryKey: string;
    response: LookupResponse;
    expiresAt: Date;
  }): Promise<void> {
    if (this.missing) return;
    try {
      await this.db.execute(sql`
        INSERT INTO lookup_cache (lookup_id, query_key, response, expires_at)
        VALUES (${entry.lookupId}, ${entry.queryKey}, ${JSON.stringify(entry.response)}::jsonb,
                ${entry.expiresAt.toISOString()}::timestamptz)
        ON CONFLICT (lookup_id) DO UPDATE
          SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at, created_at = now()`);
    } catch (e) {
      this.onError(e);
    }
  }

  private onError(e: unknown): null {
    if (!isMissingTable(e)) throw e;
    this.missing = true;
    this.logger.warn("lookup_cache table is missing; live lookup runs uncached");
    return null;
  }
}

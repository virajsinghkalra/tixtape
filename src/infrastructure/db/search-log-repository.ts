import { sql } from "drizzle-orm";
import type { SearchLog } from "@/application/ports/engagement";
import type { Database } from "@/db/client";

/** Anonymous `search_log` (D-047 §6): normalized query, result count, clicked event. No user, no IP. */
export class PgSearchLogRepository implements SearchLog {
  constructor(private readonly db: Database) {}

  async recordSearch(queryNormalized: string, resultsCount: number, at: Date): Promise<void> {
    await this.db.execute(sql`
      insert into search_log (query_normalized, results_count, created_at)
      values (${queryNormalized}, ${resultsCount}, ${at.toISOString()}::timestamptz)`);
  }

  async listZeroResultQueries(since: Date, limit: number) {
    const rows = await this.db.execute<{ query: string; count: number }>(sql`
      select query_normalized as query, count(*)::int as count from search_log
      where created_at >= ${since.toISOString()}::timestamptz and results_count = 0
      group by query_normalized order by count(*) desc, query_normalized limit ${limit}`);
    return rows.map((r) => ({ query: r.query, count: r.count }));
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const rows = await this.db.execute<{ id: string }>(sql`
      delete from search_log where created_at < ${before.toISOString()}::timestamptz returning id`);
    return rows.length;
  }
}

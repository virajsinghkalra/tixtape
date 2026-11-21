import { sql } from "drizzle-orm";
import type { SearchLog } from "@/application/ports/engagement";
import type { Database } from "@/db/client";
import type { EventId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import { isForeignKeyViolation } from "./pg-errors";

/** A click this soon after the same committed query belongs to it. */
const CLICK_MATCH_WINDOW_SECONDS = 30 * 60;

/** Anonymous `search_log` (D-047 §6): normalized query, result count, clicked event. No user, no IP. */
export class PgSearchLogRepository implements SearchLog {
  constructor(private readonly db: Database) {}

  async recordSearch(queryNormalized: string, resultsCount: number, at: Date): Promise<void> {
    await this.db.execute(sql`
      insert into search_log (query_normalized, results_count, created_at)
      values (${queryNormalized}, ${resultsCount}, ${at.toISOString()}::timestamptz)`);
  }

  async recordClick(queryNormalized: string, eventId: EventId, at: Date): Promise<void> {
    try {
      await this.db.execute(sql`
        with latest as (
          select id from search_log
          where query_normalized = ${queryNormalized} and clicked_event_id is null
            and created_at >= ${at.toISOString()}::timestamptz - make_interval(secs => ${CLICK_MATCH_WINDOW_SECONDS})
          order by created_at desc limit 1
        ),
        marked as (
          update search_log set clicked_event_id = ${eventId}::uuid
          where id in (select id from latest) returning id
        )
        insert into search_log (query_normalized, results_count, clicked_event_id, created_at)
        select ${queryNormalized}, 1, ${eventId}::uuid, ${at.toISOString()}::timestamptz
        where not exists (select 1 from marked)`);
    } catch (e) {
      if (isForeignKeyViolation(e)) throw new NotFoundError("That event doesn't exist.");
      throw e;
    }
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

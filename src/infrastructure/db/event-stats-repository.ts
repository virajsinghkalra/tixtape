import { sql } from "drizzle-orm";
import type { EventEngagement } from "@/application/ports/engagement";
import type { Database } from "@/db/client";
import { ENGAGEMENT_WEIGHTS, TREND_HALF_LIFE_MS, type EngagementKind } from "@/domain/events/trend";
import type { EventId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";

const COUNTER: Record<EngagementKind, string> = {
  view: "views",
  search_click: "search_clicks",
  playlist_open: "playlist_opens",
};

/**
 * `event_stats` upsert (D-047 §4). Decay and bump happen in one statement, so concurrent
 * bumps never lose each other: score = score × 0.5^(age / 7 days) + weight (`bumpTrend`).
 * Missing and unpublished events are both "not found" (D-056).
 */
export class PgEventStatsRepository implements EventEngagement {
  constructor(private readonly db: Database) {}

  async isPublished(eventId: EventId): Promise<boolean> {
    const rows = await this.db.execute(
      sql`select 1 from events where id = ${eventId}::uuid and visibility = 'published'`,
    );
    return rows.length > 0;
  }

  async record(eventId: EventId, kind: EngagementKind, at: Date): Promise<void> {
    const counter = sql.identifier(COUNTER[kind]);
    const weight = ENGAGEMENT_WEIGHTS[kind];
    const atIso = at.toISOString();
    // Published only (D-056); a missing or hidden event bumps nothing and reads as not found.
    const rows = await this.db.execute(sql`
      insert into event_stats (event_id, ${counter}, trend_score, trend_updated_at)
      select id, 1, ${weight}, ${atIso}::timestamptz from events
      where id = ${eventId}::uuid and visibility = 'published'
      on conflict (event_id) do update set
        ${counter} = event_stats.${counter} + 1,
        trend_score = event_stats.trend_score * power(0.5, greatest(0,
            extract(epoch from (excluded.trend_updated_at - event_stats.trend_updated_at)))
            / ${TREND_HALF_LIFE_MS / 1000}::float8) + excluded.trend_score,
        trend_updated_at = greatest(excluded.trend_updated_at, event_stats.trend_updated_at)
      returning event_id
    `);
    if (rows.length === 0) throw new NotFoundError("That event doesn't exist.");
  }
}

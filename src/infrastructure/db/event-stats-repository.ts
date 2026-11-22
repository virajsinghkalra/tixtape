/**
 * `event_stats` from the anonymous D-090 analytics (QA-F-7; D-047 §4 weights and half-life):
 * - `event_open` is a view (1), or a search click-through (3) when the same device ran a
 *   `search` in the 30 minutes before it;
 * - `playlist_make` and `playlist_open_spotify` are playlist opens (5).
 * Each counts once per device, event, kind and IST day, so reloads can't inflate a score.
 * Only published events get stats (D-056). Recomputed from scratch each run: idempotent.
 */
import { sql } from "drizzle-orm";
import type { EventStatsRollup } from "@/application/ports/engagement";
import type { Database } from "@/db/client";
import { ENGAGEMENT_WEIGHTS, TREND_HALF_LIFE_MS } from "@/domain/events/trend";

/** Older activity has decayed below a thousandth of its weight (10 half-lives). */
const WINDOW_DAYS = 70;
/** A search this soon before an event open makes it a click-through. */
const CLICK_THROUGH_MINUTES = 30;

export class PgEventStatsRollup implements EventStatsRollup {
  constructor(private readonly db: Database) {}

  async rollup(now: Date): Promise<{ events: number }> {
    const at = now.toISOString();
    const w = ENGAGEMENT_WEIGHTS;
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ event_id: string }>(sql`
        with acts as (
          select a.id, a.device_id, (a.props->>'eventId')::uuid as event_id, a.name, a.at
          from analytics_events a
          where a.at >= ${at}::timestamptz - make_interval(days => ${WINDOW_DAYS})
            and a.at <= ${at}::timestamptz
            and a.name in ('event_open', 'playlist_make', 'playlist_open_spotify')
            and a.props->>'eventId' ~ '^[0-9a-fA-F-]{36}$'
        ),
        kinds as (
          select acts.*,
            case
              when acts.name <> 'event_open' then 'playlist_open'
              when acts.device_id is not null and exists (
                select 1 from analytics_events s
                where s.name = 'search' and s.device_id = acts.device_id
                  and s.at between acts.at - make_interval(mins => ${CLICK_THROUGH_MINUTES}) and acts.at
              ) then 'search_click'
              else 'view'
            end as kind
          from acts
        ),
        once as (
          -- One per device, event, kind and IST day; an anonymised event counts on its own.
          select event_id, kind, max(at) as at
          from kinds
          group by event_id, kind, coalesce(device_id::text, id::text),
            (at at time zone 'Asia/Kolkata')::date
        ),
        scores as (
          select o.event_id,
            count(*) filter (where o.kind = 'view')::int as views,
            count(*) filter (where o.kind = 'search_click')::int as search_clicks,
            count(*) filter (where o.kind = 'playlist_open')::int as playlist_opens,
            sum(
              case o.kind when 'view' then ${w.view}::float8
                          when 'search_click' then ${w.search_click}::float8
                          else ${w.playlist_open}::float8 end
              * power(0.5, greatest(0, extract(epoch from (${at}::timestamptz - o.at)))
                           / ${TREND_HALF_LIFE_MS / 1000}::float8)
            ) as trend
          from once o
          join events e on e.id = o.event_id and e.visibility = 'published'
          group by o.event_id
        ),
        upserted as (
          insert into event_stats (event_id, views, search_clicks, playlist_opens, trend_score, trend_updated_at)
          select event_id, views, search_clicks, playlist_opens, trend, ${at}::timestamptz from scores
          on conflict (event_id) do update set
            views = excluded.views,
            search_clicks = excluded.search_clicks,
            playlist_opens = excluded.playlist_opens,
            trend_score = excluded.trend_score,
            trend_updated_at = excluded.trend_updated_at
          returning event_id
        )
        select event_id::text from upserted
      `);
      const touched = rows.map((r) => r.event_id);
      // Events with no recent activity (or no longer published) fall back to nothing.
      await tx.execute(sql`
        update event_stats set views = 0, search_clicks = 0, playlist_opens = 0,
          trend_score = 0, trend_updated_at = ${at}::timestamptz
        where not (event_id::text = any(array[${sql.join(
          touched.map((id) => sql`${id}`),
          sql`, `,
        )}]::text[]))`);
      return { events: touched.length };
    });
  }
}

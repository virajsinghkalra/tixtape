/**
 * D-090: the admin analytics read model. Plain SQL aggregations over the last 30 days, shaped
 * for the indexes in migration 0018:
 * - active devices come from `devices.last_seen` (one small table, exact for rolling windows);
 * - the daily line and funnel scan `(at, device_id)` / `(name, at)`;
 * - "top" lists aggregate first, then join the few winners to events and artists.
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  AnalyticsDashboard,
  AnalyticsOverview,
  AnalyticsReadModel,
  Count,
  FunnelStep,
  NamedPerson,
  TimelineEntry,
  TopLists,
} from "@/application/ports/analytics";
import type { Database } from "@/db/client";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;
const TOP = 10;
const PEOPLE_LIMIT = 100;
const TIMELINE_LIMIT = 100;
const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);
/** A timestamp parameter (raw SQL params must be strings with `prepare: false`). */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
/** IST calendar date "YYYY-MM-DD". */
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

type PersonRow = {
  id: string;
  nickname: string | null;
  name: string | null;
  email: string | null;
  consent_at: Date | null;
  first_seen: Date | null;
  last_seen: Date | null;
  source: string | null;
  devices: number;
  events: number;
};

export class PgAnalyticsDashboard implements AnalyticsReadModel {
  constructor(private readonly db: Database) {}

  private async rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
    return [...(await this.db.execute(query))] as T[];
  }

  async dashboard(now: Date): Promise<AnalyticsDashboard> {
    const since = ago(now, WINDOW_DAYS);
    const [overview, funnel, top, people, anonymous] = await Promise.all([
      this.overview(now),
      this.funnel(since),
      this.top(since),
      this.people(sql`true`),
      this.rows<{ n: number }>(sql`
        select count(*)::int as n from devices
        where last_seen >= ${ts(since)} and person_id is null`),
    ]);
    return { overview, funnel, top, people, anonymousDevices: anonymous[0]?.n ?? 0 };
  }

  private async overview(now: Date): Promise<AnalyticsOverview> {
    const [counts] = await this.rows<{
      dau: number;
      wau: number;
      mau: number;
      fresh: number;
    }>(sql`
      select
        count(*) filter (where last_seen >= ${ts(ago(now, 1))})::int as dau,
        count(*) filter (where last_seen >= ${ts(ago(now, 7))})::int as wau,
        count(*)::int as mau,
        count(*) filter (where last_seen >= ${ts(ago(now, 7))} and first_seen >= ${ts(ago(now, 7))})::int as fresh
      from devices
      where last_seen >= ${ts(ago(now, WINDOW_DAYS))}`);
    const perDay = await this.rows<{ day: string; devices: number }>(sql`
      select to_char((at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
             count(distinct device_id)::int as devices
      from analytics_events
      where at >= ${ts(new Date(`${istDay(ago(now, WINDOW_DAYS - 1))}T00:00:00+05:30`))}
      group by 1`);
    const byDay = new Map(perDay.map((r) => [r.day, r.devices]));
    const daily = Array.from({ length: WINDOW_DAYS }, (_, i) => {
      const day = istDay(ago(now, WINDOW_DAYS - 1 - i));
      return { day, devices: byDay.get(day) ?? 0 };
    });
    const wau = counts?.wau ?? 0;
    const fresh = counts?.fresh ?? 0;
    return {
      dau: counts?.dau ?? 0,
      wau,
      mau: counts?.mau ?? 0,
      newDevices: fresh,
      returningDevices: wau - fresh,
      daily,
    };
  }

  private async funnel(since: Date): Promise<FunnelStep[]> {
    // One row per device (hash aggregate), then count: about 2× faster than four DISTINCTs.
    const [r] = await this.rows<{ visit: number; search: number; open: number; playlist: number }>(
      sql`
      select count(*) filter (where v)::int as visit, count(*) filter (where s)::int as search,
             count(*) filter (where o)::int as open, count(*) filter (where p)::int as playlist
      from (
        select device_id,
               bool_or(name = 'page_view') as v,
               bool_or(name = 'search') as s,
               bool_or(name = 'event_open') as o,
               bool_or(name in ('playlist_make', 'playlist_open_spotify')) as p
        from analytics_events
        where at >= ${ts(since)} and device_id is not null
          and name in ('page_view', 'search', 'event_open', 'playlist_make', 'playlist_open_spotify')
        group by device_id
      ) per_device`,
    );
    return [
      { step: "Visit", devices: r?.visit ?? 0 },
      { step: "Search", devices: r?.search ?? 0 },
      { step: "Event open", devices: r?.open ?? 0 },
      { step: "Playlist", devices: r?.playlist ?? 0 },
    ];
  }

  private counts(query: SQL): Promise<Count[]> {
    return this.rows<Count>(query);
  }

  private async top(since: Date): Promise<TopLists> {
    const opened = sql`
      select props->>'eventId' as id, count(*)::int as n
      from analytics_events
      where name = 'event_open' and at >= ${ts(since)} and props->>'eventId' ~ ${UUID_RE}
      group by 1`;
    const [events, artists, wanted, searches, zeroResults, cities, sources, shares] =
      await Promise.all([
        this.rows<{ eventId: string; title: string | null; opens: number }>(sql`
          with o as (${opened} order by n desc limit ${TOP})
          select o.id as "eventId", e.title, o.n as opens
          from o left join events e on e.id = o.id::uuid
          order by o.n desc, e.title`),
        this.counts(sql`
          with o as (${opened})
          select a.name as key, sum(o.n)::int as count
          from o
          join event_artists ea on ea.event_id = o.id::uuid and ea.tier = 'headliner'
          join artists a on a.id = ea.artist_id
          group by a.name order by 2 desc, 1 limit ${TOP}`),
        this.counts(sql`
          select min(props->>'artist') as key, count(distinct device_id)::int as count
          from analytics_events
          where name in ('ping_me', 'follow') and at >= ${ts(since)}
          group by lower(props->>'artist') order by 2 desc, 1 limit ${TOP}`),
        this.rows<{ query: string; count: number; results: number }>(sql`
          select lower(props->>'q') as query, count(*)::int as count,
                 max((props->>'results')::int) as results
          from analytics_events
          where name = 'search' and at >= ${ts(since)}
          group by 1 order by 2 desc, 1 limit ${TOP}`),
        this.counts(sql`
          select lower(props->>'q') as key, count(*)::int as count
          from analytics_events
          where name = 'search' and at >= ${ts(since)} and props->>'results' = '0'
          group by 1 order by 2 desc, 1 limit ${TOP}`),
        this.counts(sql`
          select city as key, count(*)::int as count
          from (
            select distinct city, device_id from analytics_events
            where at >= ${ts(since)} and city is not null and device_id is not null
          ) x
          group by 1 order by 2 desc, 1 limit ${TOP}`),
        this.counts(sql`
          select first_source as key, count(*)::int as count
          from devices where first_seen >= ${ts(since)}
          group by 1 order by 2 desc, 1 limit ${TOP}`),
        this.counts(sql`
          select props->>'channel' as key, count(*)::int as count
          from analytics_events
          where name = 'share' and at >= ${ts(since)}
          group by 1 order by 2 desc, 1`),
      ]);
    return { events, artists, wanted, searches, zeroResults, cities, sources, shares };
  }

  private async people(where: SQL): Promise<NamedPerson[]> {
    const rows = await this.rows<PersonRow>(sql`
      select p.id, p.nickname, p.name, p.email, p.consent_at,
             d.first_seen, d.last_seen, d.source, coalesce(d.devices, 0) as devices,
             coalesce(ev.n, 0) as events
      from people p
      left join lateral (
        select min(first_seen) as first_seen, max(last_seen) as last_seen,
               (array_agg(first_source order by first_seen))[1] as source,
               count(*)::int as devices
        from devices where person_id = p.id
      ) d on true
      left join lateral (
        select count(*)::int as n
        from analytics_events e join devices dd on dd.id = e.device_id
        where dd.person_id = p.id
      ) ev on true
      where (p.nickname is not null or p.email is not null) and ${where}
      order by d.last_seen desc nulls last, p.created_at desc
      limit ${PEOPLE_LIMIT}`);
    return rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      name: r.name,
      email: r.email,
      consentAt: toDate(r.consent_at),
      firstSeen: toDate(r.first_seen),
      lastSeen: toDate(r.last_seen),
      source: r.source,
      devices: r.devices,
      events: r.events,
    }));
  }

  async person(id: string): Promise<{ person: NamedPerson; timeline: TimelineEntry[] } | null> {
    if (!new RegExp(UUID_RE).test(id)) return null;
    const [person] = await this.people(sql`p.id = ${id}::uuid`);
    if (!person) return null;
    const rows = await this.rows<{ name: string; props: Record<string, unknown>; at: Date }>(sql`
      select e.name, e.props, e.at
      from analytics_events e join devices d on d.id = e.device_id
      where d.person_id = ${id}::uuid
      order by e.at desc
      limit ${TIMELINE_LIMIT}`);
    return {
      person,
      timeline: rows.map((r) => ({ name: r.name, props: r.props, at: toDate(r.at)! })),
    };
  }
}

/** postgres.js returns timestamps from raw SQL as Date or string depending on the path. */
function toDate(v: Date | string | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

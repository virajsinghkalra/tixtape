/**
 * Postgres search (D-042, D-047, D-048). Uses pg_trgm `word_similarity` and `unaccent`
 * (migration 0002). Each method is one round trip. Queries over-select on purpose: the
 * domain (`rankSuggestions`, `rankArtists`, `rankCities`) decides reasons, order and limits.
 * All LIKE patterns and thresholds come from the domain's `SearchPlan`.
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  EventSearch,
  Recommendations,
  SearchCandidates,
} from "@/application/ports/event-search";
import type { Database } from "@/db/client";
import type { DateWindow } from "@/domain/events/ist-calendar";
import { phoneticSqlSteps } from "@/domain/events/phonetic";
import {
  DEFAULT_EVENT_DURATION_MS,
  type EventResult,
  type SearchPlan,
} from "@/domain/events/search";
import { TREND_HALF_LIFE_MS } from "@/domain/events/trend";
import type { EventType } from "@/domain/shared/lineup";
import { aliasCols, eventEndSql } from "./event-time";

type EventRow = {
  id: string;
  title: string;
  type: EventType;
  starts_at: string;
  starts_at_date_only: boolean;
  city: string | null;
  venue_name: string | null;
};
type CandidateRow = EventRow & {
  venue_norm: string | null;
  title_sim: number;
  venue_sim: number;
  trend_score: number;
  trend_updated_at: string;
  artist_name: string | null;
  artist_norm: string | null;
  artist_sim: number | null;
  artist_is_filter: boolean | null;
};
type ArtistRow = {
  id: string;
  name: string;
  normalized_name: string;
  spotify_id: string | null;
  image_url: string | null;
  sim: number;
  is_filter: boolean;
  upcoming_count: number;
};

/** `%`, `_` and `\` are literals in user text. The domain already folds them away; defence in depth. */
const escapeLike = (s: string) => s.replace(/[\\%_]/gu, (c) => `\\${c}`);
const likeArray = (patterns: string[]): SQL =>
  sql`array[${sql.join(
    patterns.map((p) => sql`${p.split("%").map(escapeLike).join("%")}`),
    sql`, `,
  )}]::text[]`;
const ts = (d: Date | null): SQL => sql`${d === null ? null : d.toISOString()}::timestamptz`;
const text = (s: string | null): SQL => sql`${s}::text`;

/** The domain's phonetic rules as nested SQL (`phoneticKey` in TypeScript). */
function phonetic(expr: SQL): SQL {
  return phoneticSqlSteps().reduce<SQL>(
    (inner, { from, to }) => sql`replace(${inner}, ${from}::text, ${to}::text)`,
    expr,
  );
}

const upcoming = (now: Date): SQL =>
  sql`${eventEndSql(aliasCols("e"), DEFAULT_EVENT_DURATION_MS)} >= ${ts(now)}`;

/** Users only ever see published events that haven't ended (D-056). */
const publicUpcoming = (now: Date): SQL => sql`e.visibility = 'published' and ${upcoming(now)}`;

const decayedTrend = (now: Date): SQL =>
  sql`coalesce(s.trend_score, 0)::float8 * power(0.5, greatest(0, extract(epoch from (${ts(now)} - coalesce(s.trend_updated_at, ${ts(now)})))) / ${TREND_HALF_LIFE_MS / 1000}::float8)`;

const toEventResult = (r: EventRow): EventResult => ({
  id: r.id,
  title: r.title,
  type: r.type,
  startsAt: new Date(r.starts_at),
  startsAtDateOnly: r.starts_at_date_only,
  city: r.city,
  venueName: r.venue_name,
});

export class PgEventSearch implements EventSearch {
  constructor(private readonly db: Database) {}

  async findCandidates(plan: SearchPlan, now: Date, limit: number): Promise<SearchCandidates> {
    const f = plan.filters;
    const fuzzy = sql`${plan.fuzzy}::boolean`;
    const hasText = sql`${plan.hasText}::boolean`;
    const near = sql`${plan.nearMissThreshold}::float8`;
    const strong = sql`${plan.fuzzyThreshold}::float8`;
    const isFilterArtist = (col: SQL) =>
      sql`(${text(f.artistKey)} is not null and (${col}.normalized_name = ${text(f.artistKey)}
        or ${col}.id in (select artist_id from artist_aliases where alias_normalized = ${text(f.artistKey)})))`;

    const [row] = await this.db.execute<{
      events: CandidateRow[];
      artists: ArtistRow[];
      cities: { city: string; upcoming_count: number }[];
    }>(sql`
      with base as (
        select e.id, e.title, e.type, e.starts_at, e.starts_at_date_only,
          v.city, v.name as venue_name, v.normalized_name as venue_norm,
          lower(unaccent(e.title)) as t,
          coalesce(s.trend_score, 0)::float8 as trend_score,
          coalesce(s.trend_updated_at, ${ts(now)}) as trend_updated_at
        from events e
        left join venues v on v.id = e.venue_id
        left join event_stats s on s.event_id = e.id
        where ${publicUpcoming(now)}
          and (${text(f.city)} is null or v.city = ${text(f.city)})
          and (${ts(f.from)} is null or ${eventEndSql(aliasCols("e"))} >= ${ts(f.from)})
          and (${ts(f.to)} is null or e.starts_at <= ${ts(f.to)})
          and (${text(f.type)} is null or e.type::text = ${text(f.type)}
            or (${text(f.typeTitlePattern)} is not null and lower(e.title) like ${text(f.typeTitlePattern)}))
          and (cardinality(${likeArray(f.genreAny)}) = 0
            or lower(unaccent(coalesce(e.genre, ''))) like any(${likeArray(f.genreAny)}))
          and (${text(f.artistKey)} is null or exists (
            select 1 from event_artists ea join artists ar on ar.id = ea.artist_id
            where ea.event_id = e.id and ${isFilterArtist(sql`ar`)}))
      ),
      -- Similarities are computed once per row here and reused below.
      filtered as materialized (
        select b.*,
          case when ${fuzzy} then greatest(
            word_similarity(${plan.text}::text, b.t),
            word_similarity(${plan.phonetic}::text, ${phonetic(sql`b.t`)})
          ) else 0 end as title_sim,
          case when ${fuzzy} and b.venue_norm is not null
            then word_similarity(${plan.venueKey}::text, b.venue_norm) else 0 end as venue_sim
        from base b
      ),
      scored_artists as (
        select ar.id, ar.name, ar.normalized_name, ar.spotify_id, ar.image_url,
          case when ${fuzzy} then greatest(
            word_similarity(${plan.artistKey}::text, ar.normalized_name),
            word_similarity(${plan.artistPhonetic}::text, p.key)
          ) else 0 end as sim,
          ${isFilterArtist(sql`ar`)} as is_filter,
          (ar.normalized_name like any(${likeArray(plan.artistAny)})
            or lower(unaccent(ar.name)) like any(${likeArray(plan.artistAny)})
            or p.key like any(${likeArray(plan.artistPhoneticAny)})) as direct
        from artists ar
        cross join lateral (select ${phonetic(sql`ar.normalized_name`)} as key) p
        where (${hasText} or ${text(f.artistKey)} is not null)
          -- Only artists playing a published, upcoming event: hidden events leak nothing,
          -- not even through "did you mean" (D-056, QA-E-4).
          and ar.id in (
            select ea.artist_id from event_artists ea join filtered f on f.id = ea.event_id)
      ),
      matched_artists as materialized (
        select * from scored_artists
        where is_filter or (${hasText} and (direct or sim >= ${near}))
      ),
      lineup as (
        select ea.event_id, ea.artist_id, ea.billing_rank
        from event_artists ea
        join matched_artists m on m.id = ea.artist_id
        join filtered f on f.id = ea.event_id
      ),
      best_artist as (
        select distinct on (l.event_id) l.event_id, m.name, m.normalized_name, m.sim, m.is_filter
        from lineup l join matched_artists m on m.id = l.artist_id
        order by l.event_id, m.is_filter desc, m.direct desc, m.sim desc, l.billing_rank
      ),
      candidates as (
        select f.id, f.title, f.type, f.starts_at, f.starts_at_date_only, f.city, f.venue_name,
          f.venue_norm, f.t, f.trend_score, f.trend_updated_at, f.title_sim, f.venue_sim,
          a.name as artist_name, a.normalized_name as artist_norm, a.sim as artist_sim,
          a.is_filter as artist_is_filter
        from filtered f
        left join best_artist a on a.event_id = f.id
        where not ${hasText}
          or f.t like any(${likeArray(plan.titleAny)})
          or (cardinality(${likeArray(plan.titleAll)}) > 0 and f.t like all(${likeArray(plan.titleAll)}))
          or a.name is not null
          or f.venue_norm like any(${likeArray(plan.venueAny)})
          or lower(unaccent(f.venue_name)) like any(${likeArray(plan.venueAny)})
          or lower(unaccent(f.city)) like any(${likeArray(plan.cityAny)})
          or f.title_sim >= ${near}
          or f.venue_sim >= ${strong}
      ),
      top_events as (
        -- Coarse pre-order so a big city or a loose fuzzy match can't crowd out text matches.
        select * from candidates
        order by (t like any(${likeArray(plan.titleAny)})) desc, (artist_name is not null) desc,
          greatest(title_sim, coalesce(artist_sim, 0)) desc, trend_score desc, starts_at, id
        limit ${limit}
      ),
      artist_counts as (
        select artist_id, count(distinct event_id)::int as n from lineup group by artist_id
      )
      select
        (select coalesce(json_agg(te), '[]'::json) from top_events te) as events,
        (select coalesce(json_agg(x), '[]'::json) from (
          select m.id, m.name, m.normalized_name, m.spotify_id, m.image_url, m.sim, m.is_filter,
            coalesce(c.n, 0) as upcoming_count
          from matched_artists m left join artist_counts c on c.artist_id = m.id
          order by m.is_filter desc, m.direct desc, coalesce(c.n, 0) desc, m.sim desc, m.name
          limit 20) x) as artists,
        (select coalesce(json_agg(x), '[]'::json) from (
          select f.city, count(*)::int as upcoming_count from filtered f
          where f.city is not null and (f.city = ${text(f.city)}
            or lower(unaccent(f.city)) like any(${likeArray(plan.cityAny)}))
          group by f.city order by count(*) desc, f.city limit 10) x) as cities
    `);

    return {
      events: (row?.events ?? []).map((r) => ({
        ...toEventResult(r),
        venueNormalizedName: r.venue_norm,
        titleSimilarity: Number(r.title_sim),
        venueSimilarity: Number(r.venue_sim),
        trendScore: Number(r.trend_score),
        trendUpdatedAt: new Date(r.trend_updated_at),
        artist:
          r.artist_name === null
            ? null
            : {
                name: r.artist_name,
                normalizedName: r.artist_norm ?? "",
                similarity: Number(r.artist_sim ?? 0),
                isFilter: r.artist_is_filter === true,
              },
      })),
      artists: (row?.artists ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        normalizedName: a.normalized_name,
        spotifyId: a.spotify_id,
        imageUrl: a.image_url,
        similarity: Number(a.sim),
        isFilter: a.is_filter,
        upcomingCount: a.upcoming_count,
      })),
      cities: (row?.cities ?? []).map((c) => ({ city: c.city, upcomingCount: c.upcoming_count })),
    };
  }

  async findFallback(
    filters: { city: string | null; from: Date | null; to: Date | null },
    now: Date,
    limit: number,
  ): Promise<EventResult[]> {
    const rows = await this.db.execute<EventRow>(sql`
      select e.id, e.title, e.type, e.starts_at, e.starts_at_date_only, v.city, v.name as venue_name
      from events e
      left join venues v on v.id = e.venue_id
      left join event_stats s on s.event_id = e.id
      where ${publicUpcoming(now)}
        and (${text(filters.city)} is null or v.city = ${text(filters.city)})
        and (${ts(filters.from)} is null or ${eventEndSql(aliasCols("e"))} >= ${ts(filters.from)})
        and (${ts(filters.to)} is null or e.starts_at <= ${ts(filters.to)})
      order by ${decayedTrend(now)} desc, e.starts_at, e.id
      limit ${limit}
    `);
    return rows.map(toEventResult);
  }

  async findRecommendations(input: {
    now: Date;
    weekend: DateWindow;
    city: string | null;
    perSection: number;
    popularSince: Date;
  }): Promise<Recommendations> {
    const { now, weekend, city, perSection: n } = input;
    const listed = (
      where: SQL,
    ) => sql`(select coalesce(json_agg(x order by x.trend desc, x.starts_at, x.id), '[]'::json)
      from (select * from up where ${where} order by trend desc, starts_at, id limit ${n}) x)`;
    const [row] = await this.db.execute<{
      trending: (EventRow & { trend: number })[];
      up_next: (EventRow & { trend: number })[];
      weekend: (EventRow & { trend: number })[];
      near: (EventRow & { trend: number })[];
      popular: string[];
    }>(sql`
      with up as materialized (
        select e.id, e.title, e.type, e.starts_at, e.starts_at_date_only,
          coalesce(e.ends_at, e.starts_at) as ends_at, v.city, v.name as venue_name,
          ${decayedTrend(now)} as trend
        from events e
        left join venues v on v.id = e.venue_id
        left join event_stats s on s.event_id = e.id
        where ${publicUpcoming(now)}
      )
      select
        ${listed(sql`trend > 0`)} as trending,
        (select coalesce(json_agg(x order by x.starts_at, x.id), '[]'::json)
          from (select * from up order by starts_at, id limit ${n}) x) as up_next,
        ${listed(sql`starts_at <= ${ts(weekend.to)} and ends_at >= ${ts(weekend.from)}`)} as weekend,
        ${listed(sql`${text(city)} is not null and city = ${text(city)}`)} as near,
        (select coalesce(json_agg(q.query_normalized), '[]'::json) from (
          select query_normalized from search_log
          where created_at >= ${ts(input.popularSince)} and results_count > 0
          group by query_normalized
          order by count(clicked_event_id) desc, count(*) desc, query_normalized
          limit 5) q) as popular
    `);
    return {
      trending: (row?.trending ?? []).map(toEventResult),
      upNext: (row?.up_next ?? []).map(toEventResult),
      thisWeekend: (row?.weekend ?? []).map(toEventResult),
      nearYou: (row?.near ?? []).map(toEventResult),
      popularSearches: row?.popular ?? [],
    };
  }
}

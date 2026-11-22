import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type {
  ArtistPopularityStore,
  EventFeedReader,
  FeedRow,
} from "@/application/ports/event-feed";
import type { Database } from "@/db/client";
import { asEventId, asVenueId } from "@/domain/shared/ids";
import { EVENT_STATUSES, EVENT_TYPES } from "@/domain/shared/lineup";
import { DEFAULT_EVENT_DURATION_MS } from "@/domain/events/search";
import { aliasCols, eventEndSql } from "./event-time";

const stillOn = eventEndSql(aliasCols("e"), DEFAULT_EVENT_DURATION_MS);

const row = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(EVENT_TYPES),
  status: z.enum(EVENT_STATUSES),
  starts_at: z.coerce.date(),
  starts_at_date_only: z.boolean(),
  ends_at: z.coerce.date().nullable(),
  genre: z.string().nullable(),
  image_url: z.string().nullable(),
  poster_url: z.string().nullable(),
  created_at: z.coerce.date(),
  venue_id: z.string().nullable(),
  venue_name: z.string().nullable(),
  venue_city: z.string().nullable(),
  venue_country: z.string().nullable(),
  artist_count: z.coerce.number(),
  headliners: z.array(z.string()).nullable(),
  headliner_artists: z
    .array(
      z.object({
        name: z.string(),
        imageUrl: z.string().nullable(),
        altImageUrl: z.string().nullable(),
        altImageCredit: z.string().nullable(),
      }),
    )
    .nullable(),
  headliner_listeners: z.coerce.number().nullable(),
  first_image: z.string().nullable(),
  source_count: z.coerce.number(),
  ticket_url: z.string().nullable(),
  playlist_status: z.enum(["ready", "building"]).nullable(),
  playlist_url: z.string().nullable(),
  views: z.coerce.number(),
  playlist_opens: z.coerce.number(),
});

/**
 * The home feed in one query (D-079): summary, top-billed names, the best-known headliner's
 * cached Last.fm listeners, solo photo, ticket link, source count and engagement.
 */
export class PgEventFeed implements EventFeedReader {
  constructor(private readonly db: Database) {}

  async upcoming({ from, limit }: { from: Date; limit: number }): Promise<FeedRow[]> {
    return this.select(sql`${stillOn} >= ${from.toISOString()}::timestamptz`, sql`asc`, limit);
  }

  /** Published events that ended in [from, to), most recent first (the /past page). */
  async past({ from, to, limit }: { from: Date; to: Date; limit: number }): Promise<FeedRow[]> {
    return this.select(
      sql`${stillOn} >= ${from.toISOString()}::timestamptz and ${stillOn} < ${to.toISOString()}::timestamptz`,
      sql`desc`,
      limit,
    );
  }

  private async select(when: SQL, direction: SQL, limit: number): Promise<FeedRow[]> {
    const result = await this.db.execute(sql`
      select
        e.id, e.title, e.type, e.status, e.starts_at, e.starts_at_date_only, e.ends_at, e.genre, e.image_url, e.poster_url, e.created_at,
        v.id as venue_id, v.name as venue_name, v.city as venue_city, v.country as venue_country,
        (select count(*) from event_artists ea where ea.event_id = e.id) as artist_count,
        top.names as headliners,
        top.artists as headliner_artists,
        top.listeners as headliner_listeners,
        (select a.image_url from event_artists ea join artists a on a.id = ea.artist_id
          where ea.event_id = e.id order by ea.billing_rank limit 1) as first_image,
        (select count(*) from event_sources s where s.event_id = e.id) as source_count,
        (select s.url from event_sources s where s.event_id = e.id and s.url is not null
          order by s.last_seen_at desc limit 1) as ticket_url,
        -- UX #6: is the shared playlist live (or being made)? Read only.
        case
          when exists (select 1 from shared_playlists sp where sp.event_id = e.id) then 'ready'
          when exists (select 1 from playlist_jobs j where j.event_id = e.id
            and j.status in ('queued', 'running', 'paused')) then 'building'
        end as playlist_status,
        -- One tour, one playlist: this event's own, else a ready one with the same headliners.
        coalesce(
          (select sp.url from shared_playlists sp where sp.event_id = e.id),
          (select sp.url from shared_playlists sp join events e2 on e2.id = sp.event_id
            where e2.id <> e.id and e2.visibility = 'published'
              and (select array_agg(x.artist_id order by x.artist_id) from event_artists x
                    where x.event_id = e2.id and x.tier = 'headliner')
                = (select array_agg(y.artist_id order by y.artist_id) from event_artists y
                    where y.event_id = e.id and y.tier = 'headliner')
            order by e2.starts_at limit 1)
        ) as playlist_url,
        coalesce(st.views, 0) as views,
        coalesce(st.playlist_opens, 0) as playlist_opens
      from events e
      left join venues v on v.id = e.venue_id
      left join event_stats st on st.event_id = e.id
      left join lateral (
        -- The top-billed tier (usually headliners), in billing order.
        select array_agg(a.name order by ea.billing_rank) as names,
          -- D-083: photos for the visuals system (Spotify, then the alt photo and its credit).
          json_agg(json_build_object(
            'name', a.name, 'imageUrl', a.image_url,
            'altImageUrl', a.alt_image_url, 'altImageCredit', a.alt_image_credit
          ) order by ea.billing_rank) as artists,
          max(a.lastfm_listeners) as listeners
        from event_artists ea join artists a on a.id = ea.artist_id
        where ea.event_id = e.id and ea.tier = (
          select ea2.tier from event_artists ea2 where ea2.event_id = e.id
          order by ea2.billing_rank limit 1)
      ) top on true
      where e.visibility = 'published' and ${when}
      order by e.starts_at ${direction}, e.id ${direction}
      limit ${limit}
    `);
    return [...result].map((raw) => toFeedRow(row.parse(raw)));
  }

  /** Read-only: "Open in Spotify" taps per event since `since` (analytics, no Spotify calls). */
  async spotifyOpensSince(since: Date): Promise<Map<string, number>> {
    const result = await this.db.execute(sql`
      select props->>'eventId' as event_id, count(*) as n
      from analytics_events
      where name = 'playlist_open_spotify' and at >= ${since.toISOString()}::timestamptz
        and props->>'eventId' is not null
      group by 1
    `);
    const out = new Map<string, number>();
    for (const r of result) {
      const p = z.object({ event_id: z.string(), n: z.coerce.number() }).parse(r);
      out.set(p.event_id, p.n);
    }
    return out;
  }

  /**
   * QA-F-15: which of these ids are still published. One indexed query, so a cached feed can
   * drop events hidden or archived since (by an admin, the sweep or any script) on every request.
   */
  async stillPublished(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const result = await this.db.execute(sql`
      select id from events
      where id = any(${`{${ids.join(",")}}`}::uuid[]) and visibility = 'published'
    `);
    return new Set([...result].map((r) => z.object({ id: z.string() }).parse(r).id));
  }
}

function toFeedRow(r: z.infer<typeof row>): FeedRow {
  const venue =
    r.venue_id && r.venue_name && r.venue_city
      ? {
          id: asVenueId(r.venue_id),
          name: r.venue_name,
          city: r.venue_city,
          country: r.venue_country ?? "IN",
        }
      : null;
  return {
    id: asEventId(r.id),
    title: r.title,
    type: r.type,
    status: r.status,
    startsAt: r.starts_at,
    startsAtDateOnly: r.starts_at_date_only,
    endsAt: r.ends_at,
    genre: r.genre,
    imageUrl: r.image_url,
    posterUrl: r.poster_url,
    venue,
    artistCount: r.artist_count,
    city: venue?.city ?? null,
    headliners: r.headliners ?? [],
    headlinerArtists: (r.headliner_artists ?? []).map((a, i) => ({
      ...a,
      tier: "headliner" as const,
      billingRank: i + 1,
    })),
    headlinerListeners: r.headliner_listeners,
    sourceCount: r.source_count,
    views: r.views,
    playlistOpens: r.playlist_opens,
    createdAt: r.created_at,
    soloImage: r.artist_count === 1 ? r.first_image : null,
    ticketUrl: r.ticket_url,
    playlistStatus: r.playlist_status,
    playlistUrl: r.playlist_url,
  };
}

/** `artists.lastfm_listeners` (D-079): what's due for a refresh, and saving results. */
export class PgArtistPopularityStore implements ArtistPopularityStore {
  constructor(private readonly db: Database) {}

  async due({ now, staleBefore, limit }: { now: Date; staleBefore: Date; limit: number }) {
    const result = await this.db.execute(sql`
      select distinct a.id, a.name, a.mbid
      from artists a
      join event_artists ea on ea.artist_id = a.id
      join events e on e.id = ea.event_id
      where e.visibility = 'published'
        and ${stillOn} >= ${now.toISOString()}::timestamptz
        and (a.lastfm_listeners_at is null or a.lastfm_listeners_at < ${staleBefore.toISOString()}::timestamptz)
      limit ${limit}
    `);
    return [...result].map((r) =>
      z.object({ id: z.string(), name: z.string(), mbid: z.string().nullable() }).parse(r),
    );
  }

  async save(artistId: string, listeners: number | null, at: Date): Promise<void> {
    await this.db.execute(sql`
      update artists set lastfm_listeners = ${listeners}, lastfm_listeners_at = ${at.toISOString()}::timestamptz
      where id = ${artistId}
    `);
  }
}

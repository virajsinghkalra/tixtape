import { sql } from "drizzle-orm";
import { z } from "zod";
import type {
  ArtistPopularityStore,
  EventFeedReader,
  FeedRow,
} from "@/application/ports/event-feed";
import type { Database } from "@/db/client";
import { asEventId, asVenueId } from "@/domain/shared/ids";
import { EVENT_STATUSES, EVENT_TYPES } from "@/domain/shared/lineup";
import { aliasCols, eventEndSql } from "./event-time";

const stillOn = eventEndSql(aliasCols("e"));

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
  created_at: z.coerce.date(),
  venue_id: z.string().nullable(),
  venue_name: z.string().nullable(),
  venue_city: z.string().nullable(),
  venue_country: z.string().nullable(),
  artist_count: z.coerce.number(),
  headliners: z.array(z.string()).nullable(),
  headliner_listeners: z.coerce.number().nullable(),
  first_image: z.string().nullable(),
  source_count: z.coerce.number(),
  ticket_url: z.string().nullable(),
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
    const result = await this.db.execute(sql`
      select
        e.id, e.title, e.type, e.status, e.starts_at, e.starts_at_date_only, e.ends_at, e.genre, e.image_url, e.created_at,
        v.id as venue_id, v.name as venue_name, v.city as venue_city, v.country as venue_country,
        (select count(*) from event_artists ea where ea.event_id = e.id) as artist_count,
        top.names as headliners,
        top.listeners as headliner_listeners,
        (select a.image_url from event_artists ea join artists a on a.id = ea.artist_id
          where ea.event_id = e.id order by ea.billing_rank limit 1) as first_image,
        (select count(*) from event_sources s where s.event_id = e.id) as source_count,
        (select s.url from event_sources s where s.event_id = e.id and s.url is not null
          order by s.last_seen_at desc limit 1) as ticket_url,
        coalesce(st.views, 0) as views,
        coalesce(st.playlist_opens, 0) as playlist_opens
      from events e
      left join venues v on v.id = e.venue_id
      left join event_stats st on st.event_id = e.id
      left join lateral (
        -- The top-billed tier (usually headliners), in billing order.
        select array_agg(a.name order by ea.billing_rank) as names, max(a.lastfm_listeners) as listeners
        from event_artists ea join artists a on a.id = ea.artist_id
        where ea.event_id = e.id and ea.tier = (
          select ea2.tier from event_artists ea2 where ea2.event_id = e.id
          order by ea2.billing_rank limit 1)
      ) top on true
      where e.visibility = 'published' and ${stillOn} >= ${from.toISOString()}::timestamptz
      order by e.starts_at asc, e.id asc
      limit ${limit}
    `);
    return [...result].map((raw) => toFeedRow(row.parse(raw)));
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
    venue,
    artistCount: r.artist_count,
    city: venue?.city ?? null,
    headliners: r.headliners ?? [],
    headlinerListeners: r.headliner_listeners,
    sourceCount: r.source_count,
    views: r.views,
    playlistOpens: r.playlist_opens,
    createdAt: r.created_at,
    soloImage: r.artist_count === 1 ? r.first_image : null,
    ticketUrl: r.ticket_url,
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

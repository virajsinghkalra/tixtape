/**
 * Image columns (D-083): `artists.alt_image_*` and `events.poster_*`. Never touches
 * `artists.image_url` (matching owns it) or `events.image_url` (ingestion owns it).
 */
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  ArtistImageRow,
  ArtistImageStore,
  EventPosterRow,
  EventPosterStore,
  SavedImage,
} from "@/application/ports/images";
import type { Database } from "@/db/client";
import { artists, events } from "@/db/schema";
import { asArtistId, asEventId, type ArtistId, type EventId } from "@/domain/shared/ids";
import { aliasCols, eventEndSql } from "@/infrastructure/db/event-time";

export class PgArtistImageStore implements ArtistImageStore {
  constructor(private readonly db: Database) {}

  async listDue(checkedBefore: Date, limit: number): Promise<ArtistImageRow[]> {
    const rows = await this.db
      .select({
        id: artists.id,
        name: artists.name,
        spotifyId: artists.spotifyId,
        mbid: artists.mbid,
        imageUrl: artists.imageUrl,
        altImageUrl: artists.altImageUrl,
        altImageSource: artists.altImageSource,
      })
      .from(artists)
      .where(
        and(
          isNull(artists.imageUrl),
          or(isNull(artists.altImageCheckedAt), lt(artists.altImageCheckedAt, checkedBefore)),
        ),
      )
      .orderBy(sql`${artists.altImageCheckedAt} asc nulls first`, asc(artists.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: asArtistId(r.id),
      name: r.name,
      spotifyId: r.spotifyId,
      mbid: r.mbid,
      spotifyImageUrl: r.imageUrl,
      alt: r.altImageUrl ? { url: r.altImageUrl, source: r.altImageSource } : null,
    }));
  }

  async save(id: ArtistId, image: SavedImage | null, checkedAt: Date): Promise<void> {
    await this.db
      .update(artists)
      .set({
        altImageUrl: image?.url ?? null,
        altImageCredit: image?.credit ?? null,
        altImageSource: image?.source ?? null,
        altImageCheckedAt: checkedAt,
      })
      .where(eq(artists.id, id));
  }

  async touch(id: ArtistId, checkedAt: Date): Promise<void> {
    await this.db.update(artists).set({ altImageCheckedAt: checkedAt }).where(eq(artists.id, id));
  }
}

const PosterRow = z.object({
  id: z.string(),
  title: z.string(),
  poster_url: z.string().nullable(),
  poster_source: z.string().nullable(),
  urls: z.array(z.string()).nullable(),
});

export class PgEventPosterStore implements EventPosterStore {
  constructor(private readonly db: Database) {}

  /** Upcoming published events, with their source pages (the provider keeps official ones). */
  async listDue(checkedBefore: Date, limit: number): Promise<EventPosterRow[]> {
    const rows = await this.db.execute(sql`
      select e.id, e.title, e.poster_url, e.poster_source,
             array_agg(s.url order by (s.url ~ '/(event|upcoming-show)') desc, s.url)
               filter (where s.url is not null) as urls
      from events e left join event_sources s on s.event_id = e.id
      where e.visibility = 'published'
        and ${eventEndSql(aliasCols("e"))} >= now()
        and (e.poster_checked_at is null or e.poster_checked_at < ${checkedBefore.toISOString()}::timestamptz)
      group by e.id
      order by e.poster_checked_at asc nulls first, e.starts_at, e.id
      limit ${limit}
    `);
    return [...rows].map((raw) => {
      const r = PosterRow.parse(raw);
      return {
        id: asEventId(r.id),
        title: r.title,
        officialUrls: r.urls ?? [],
        poster: r.poster_url ? { url: r.poster_url, source: r.poster_source } : null,
      };
    });
  }

  async save(id: EventId, image: SavedImage | null, checkedAt: Date): Promise<void> {
    await this.db
      .update(events)
      .set({
        posterUrl: image?.url ?? null,
        posterCredit: image?.credit ?? null,
        posterSource: image?.source ?? null,
        posterCheckedAt: checkedAt,
      })
      .where(eq(events.id, id));
  }

  async touch(id: EventId, checkedAt: Date): Promise<void> {
    await this.db.update(events).set({ posterCheckedAt: checkedAt }).where(eq(events.id, id));
  }
}

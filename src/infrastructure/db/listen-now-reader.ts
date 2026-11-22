/** Read-only data for the interim "Listen now" fallback. DB only, never Spotify. */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/client";
import { buildListenNow, type ListenNow, type SiblingCandidate } from "@/domain/events/listen-now";

const eventRow = z.object({ title: z.string() });
const billedRow = z.object({
  name: z.string(),
  spotify_id: z.string().nullable(),
  is_top: z.boolean(),
  artist_id: z.string(),
});
const candidateRow = z.object({
  id: z.string(),
  title: z.string(),
  starts_at: z.coerce.date(),
  url: z.string(),
  ids: z.string().array(),
});

/** The top-billed tier's artist ids per event (what the feed calls headliners). */
const topTier = sql`
  select ea.event_id, array_agg(ea.artist_id::text order by ea.artist_id::text) as ids
  from event_artists ea
  where ea.tier = (select ea2.tier from event_artists ea2 where ea2.event_id = ea.event_id
    order by ea2.billing_rank limit 1)
  group by ea.event_id`;

export async function readListenNow(
  db: Database,
  eventId: string,
  now: Date,
): Promise<ListenNow | null> {
  const ev = [
    ...(await db.execute(
      sql`select title from events where id = ${eventId}::uuid and visibility = 'published'`,
    )),
  ][0];
  if (!ev) return null;
  const title = eventRow.parse(ev).title;

  const billed = [
    ...(await db.execute(sql`
      select a.name, a.spotify_id, a.id::text as artist_id,
        (ea.tier = (select ea2.tier from event_artists ea2 where ea2.event_id = ea.event_id
          order by ea2.billing_rank limit 1)) as is_top
      from event_artists ea join artists a on a.id = ea.artist_id
      where ea.event_id = ${eventId}::uuid
      order by ea.billing_rank`)),
  ].map((r) => billedRow.parse(r));
  const headlinerIds = billed.filter((b) => b.is_top).map((b) => b.artist_id);

  const candidates: SiblingCandidate[] = headlinerIds.length
    ? [
        ...(await db.execute(sql`
          with top as (${topTier})
          select e.id::text as id, e.title, e.starts_at, sp.url, top.ids
          from top
          join events e on e.id = top.event_id
          join shared_playlists sp on sp.event_id = e.id
          where e.visibility = 'published' and e.id <> ${eventId}::uuid
            and cardinality(sp.track_ids) > 0
            and top.ids = (select t.ids from top t where t.event_id = ${eventId}::uuid)`)),
      ]
        .map((r) => candidateRow.parse(r))
        .map((r) => ({
          eventId: r.id,
          title: r.title,
          startsAt: r.starts_at,
          url: r.url,
          headlinerIds: r.ids,
        }))
    : [];

  return buildListenNow(
    { id: eventId, title, headlinerIds },
    billed.map((b) => ({ name: b.name, spotifyId: b.spotify_id })),
    candidates,
    now,
  );
}

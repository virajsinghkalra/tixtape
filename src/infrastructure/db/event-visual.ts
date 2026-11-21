/**
 * D-091: an event's picture facts, for `checkPublishVisual`: its poster and its headliners'
 * Spotify / alternative photos. Headliners are the `headliner` tier, or the top-billed act when
 * nobody is tiered headliner. The rule itself stays in the domain; this only reads.
 */
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/client";
import type { EventVisualRow } from "@/application/ports/events";
import type { EventVisual } from "@/domain/events/publish-visual";
import { asEventId, type EventId } from "@/domain/shared/ids";

export type { EventVisualRow };

const Row = z.object({
  id: z.string(),
  title: z.string(),
  starts_at: z.union([z.string(), z.date()]),
  poster_url: z.string().nullable(),
  headliners: z.array(
    z.object({ imageUrl: z.string().nullable(), altImageUrl: z.string().nullable() }),
  ),
});

/** Events matching `where` (over alias `e`), with their visual facts, soonest first. */
export async function eventVisuals(
  db: Database,
  where: SQL,
  limit = 500,
): Promise<EventVisualRow[]> {
  const rows = await db.execute(sql`
    select e.id, e.title, e.starts_at, e.poster_url,
      coalesce((
        select json_agg(json_build_object('imageUrl', a.image_url, 'altImageUrl', a.alt_image_url)
                        order by ea.billing_rank)
        from event_artists ea join artists a on a.id = ea.artist_id
        where ea.event_id = e.id and (
          ea.tier = 'headliner'
          or (not exists (select 1 from event_artists h where h.event_id = e.id and h.tier = 'headliner')
              and ea.billing_rank = (select min(m.billing_rank) from event_artists m where m.event_id = e.id))
        )
      ), '[]'::json) as headliners
    from events e
    where ${where}
    order by e.starts_at, e.id
    limit ${limit}
  `);
  return [...rows].map((raw) => {
    const r = Row.parse(raw);
    return {
      id: asEventId(r.id),
      title: r.title,
      startsAt: new Date(r.starts_at),
      visual: { posterUrl: r.poster_url, headliners: r.headliners },
    };
  });
}

/** One event's visual facts, or null when there's no such event. */
export async function eventVisual(db: Database, eventId: EventId): Promise<EventVisual | null> {
  const [row] = await eventVisuals(db, sql`e.id = ${eventId}::uuid`, 1);
  return row?.visual ?? null;
}

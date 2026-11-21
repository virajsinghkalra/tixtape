/**
 * D-066: resolve one event's unmatched lineup with the event as context, so web corroboration
 * can search "<artist> … <city> <festival>".
 */
import type { Artist } from "@/application/ports/artists";
import type { ArtistId, EventId } from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";
import { err, ok, type Result } from "@/lib/result";
import { resolveEach, type ResolveBatchReport, type ResolveDeps } from "./resolve-artist";

export type EventLineup = {
  title: string;
  city: string | null;
  genre: string | null;
  artists: { artistId: ArtistId; matchStatus: MatchStatus }[];
};

/** Read side of the Events module that Matching needs. Implemented by the Events team. */
export interface EventLineupReader {
  getEventLineup(id: EventId): Promise<EventLineup | null>;
}

/** Confirmed matches (`auto`, `manual`) are left alone; everything else is tried again. */
const UNRESOLVED: readonly MatchStatus[] = ["pending", "needs_review", "not_found"];

export async function resolveEventLineup(
  deps: ResolveDeps & { eventLineups: EventLineupReader },
  eventId: EventId,
): Promise<Result<ResolveBatchReport, "event_not_found">> {
  const lineup = await deps.eventLineups.getEventLineup(eventId);
  if (!lineup) return err("event_not_found");
  const context = {
    event: { title: lineup.title, city: lineup.city },
    eventGenres: lineup.genre ? [lineup.genre] : [],
  };
  const artists: Artist[] = [];
  for (const entry of lineup.artists.filter((a) => UNRESOLVED.includes(a.matchStatus))) {
    const artist = await deps.artists.findById(entry.artistId);
    if (artist) artists.push(artist);
  }
  return ok(
    await resolveEach(
      deps,
      artists.map((artist) => ({ artist, context })),
    ),
  );
}

/**
 * "Sounds like this" (UX #7, OD-8, D-088): when a search finds nothing, upcoming shows by
 * artists similar to the one searched. Similar names come from Last.fm (cached); the shows
 * come from our own catalogue. Never blocks or breaks the empty state: any failure is "none".
 */
import type { EventResult } from "@/domain/events/search";
import type { SimilarArtistSource } from "@/application/ports/similar-artists";

export type SimilarShow = EventResult & { artist: string };
export type SimilarShows = { artists: string[]; shows: SimilarShow[] };

export type SimilarShowsDeps = {
  similar: SimilarArtistSource;
  /** Upcoming published shows with this artist on the lineup (exact name or alias). */
  showsBy: (artistName: string, limit: number) => Promise<EventResult[]>;
  logger: { warn: (obj: object, msg: string) => void };
};

/** Similar artists checked against our lineups (one cheap query each). */
export const MAX_SIMILAR_CHECKED = 8;
/** One horizontal row (UX #7: ≤ 6 cards). */
export const MAX_SIMILAR_SHOWS = 6;
const SHOWS_PER_ARTIST = 2;

export async function similarShows(deps: SimilarShowsDeps, artist: string): Promise<SimilarShows> {
  let names: string[];
  try {
    names = await deps.similar.similarTo(artist);
  } catch (err) {
    deps.logger.warn({ err }, "similar: Last.fm unavailable");
    return { artists: [], shows: [] };
  }
  const checked = names.slice(0, MAX_SIMILAR_CHECKED);
  const found = await Promise.all(
    checked.map((name) =>
      deps.showsBy(name, SHOWS_PER_ARTIST).catch((err: unknown) => {
        deps.logger.warn({ err }, "similar: show lookup failed");
        return [] as EventResult[];
      }),
    ),
  );
  // Most similar artist first; each event once.
  const seen = new Set<string>();
  const shows: SimilarShow[] = [];
  found.forEach((events, i) => {
    for (const e of events) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      shows.push({ ...e, artist: checked[i]! });
    }
  });
  const playing = new Set(shows.map((s) => s.artist));
  return {
    artists: checked.filter((n) => playing.has(n)),
    shows: shows.slice(0, MAX_SIMILAR_SHOWS),
  };
}

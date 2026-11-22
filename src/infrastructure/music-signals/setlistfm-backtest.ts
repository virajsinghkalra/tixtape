/**
 * Backtest harness for setlist prediction. Ranks with the real `SetlistfmScores` adapter, fed
 * only the setlists dated before the show being predicted (a fetch that serves a filtered
 * copy of one cached search response), so no ranking logic is duplicated. No Spotify.
 */
import type { Clock } from "@/application/ports/clock";
import { scorePrediction, type PredictionScore } from "@/domain/playlists/prediction-score";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { SetlistfmScores } from "./setlistfm";

type RawSong = { name?: string; tape?: boolean };
export type RawSetlist = {
  eventDate?: string;
  artist: { name: string };
  tour?: { name: string };
  sets?: { set?: { song?: RawSong[] }[] };
};
export type RawSearch = { setlist?: RawSetlist[] };

/** setlist.fm dates are dd-MM-yyyy; returns a sortable yyyyMMdd number, NaN if malformed. */
export const dateKey = (eventDate: string | undefined): number => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(eventDate ?? "");
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : NaN;
};

/** Same rule as the adapter: no intro/outro tapes, no blank entries. */
export const songsOf = (s: RawSetlist): string[] =>
  (s.sets?.set ?? []).flatMap((set) =>
    (set.song ?? [])
      .filter((g) => !g.tape && (g.name ?? "").trim() !== "")
      .map((g) => g.name ?? ""),
  );

/** The artist's own non-empty, dated setlists, newest first. */
export function ownSetlists(body: RawSearch, artistName: string): RawSetlist[] {
  const target = normalizeArtistName(artistName);
  return (body.setlist ?? [])
    .filter(
      (s) =>
        normalizeArtistName(s.artist.name) === target &&
        songsOf(s).length > 0 &&
        !Number.isNaN(dateKey(s.eventDate)),
    )
    .sort((a, b) => dateKey(b.eventDate) - dateKey(a.eventDate));
}

/** Only setlists strictly before `show`: the cut-off that keeps the backtest honest. */
export const priorTo = (setlists: RawSetlist[], show: RawSetlist): RawSetlist[] =>
  setlists.filter((s) => dateKey(s.eventDate) < dateKey(show.eventDate));

const clock: Clock = { now: () => new Date() };

/** Top `n` titles the real adapter ranks from `prior` alone (empty when it knows nothing). */
export async function predictTitles(
  artistName: string,
  prior: RawSetlist[],
  n: number,
): Promise<string[]> {
  const body: RawSearch = { setlist: prior };
  const src = new SetlistfmScores({
    apiKey: "backtest",
    clock,
    sleep: async () => undefined,
    fetch: async () => Response.json(body),
  });
  const { songs } = await src.scores(artistName);
  return songs
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .map((s) => s.title);
}

export const MIN_PRIOR_SETLISTS = 3;
/** Shorter setlists are usually incomplete setlist.fm entries, not real shows. */
export const MIN_FULL_SETLIST_SONGS = 6;

export type ShowResult = { date: string; score: PredictionScore; copyLast: PredictionScore };
export type ArtistBacktest =
  | { artist: string; insufficient: true }
  | { artist: string; insufficient: false; shows: ShowResult[] };

/** Predicts each of the latest `k` shows from earlier ones only. */
export async function backtestArtist(
  artistName: string,
  body: RawSearch,
  k: number,
): Promise<ArtistBacktest> {
  const all = ownSetlists(body, artistName);
  const shows: ShowResult[] = [];
  const targets = all.filter((s) => songsOf(s).length >= MIN_FULL_SETLIST_SONGS);
  for (const show of targets.slice(0, k)) {
    const prior = priorTo(all, show);
    if (prior.length < MIN_PRIOR_SETLISTS) continue;
    const actual = songsOf(show);
    const predicted = await predictTitles(artistName, prior, actual.length);
    // Report-only yardstick: replay the most recent full prior show, cut to the same length.
    const last = prior.find((s) => songsOf(s).length >= MIN_FULL_SETLIST_SONGS) ?? prior[0]!;
    shows.push({
      date: show.eventDate ?? "",
      score: scorePrediction(predicted, actual),
      copyLast: scorePrediction(songsOf(last).slice(0, actual.length), actual),
    });
  }
  return shows.length === 0
    ? { artist: artistName, insufficient: true }
    : { artist: artistName, insufficient: false, shows };
}

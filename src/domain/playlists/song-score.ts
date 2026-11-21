/**
 * D-085: blending song popularity signals into one score. Pure.
 * Each provider gives a 0–1 score per song; the blend is a weighted mean over the providers
 * that know the artist, so an artist with no setlists is ranked by Last.fm alone (and vice
 * versa), never penalised for a missing source. New providers add a weight here.
 */

/** Provider ids as stored with cached songs. */
export const SONG_PROVIDERS = ["lastfm", "setlistfm"] as const;
export type SongProvider = (typeof SONG_PROVIDERS)[number];

/** Last.fm says what people stream; setlist.fm says what the crowd will hear live. */
export const PROVIDER_WEIGHTS: Record<SongProvider, number> = { lastfm: 0.6, setlistfm: 0.4 };

/** Last.fm rank → 0–1 over its top-50 list (rank 1 = 1.0). */
export const LASTFM_LIST_SIZE = 50;
export const lastfmScore = (rank: number | null): number =>
  rank === null ? 0 : Math.max(0, 1 - (rank - 1) / LASTFM_LIST_SIZE);

/** setlist.fm: share of recent setlists with the song, plus a bonus if the current tour plays it. */
export const CURRENT_TOUR_BONUS = 0.25;
export function setlistScore(plays: number, setlists: number, onCurrentTour: boolean): number {
  if (setlists <= 0 || plays <= 0) return 0;
  return Math.min(1, plays / setlists + (onCurrentTour ? CURRENT_TOUR_BONUS : 0));
}

/**
 * The weighted mean of the scores from providers that know this artist (`known`). A song a
 * known provider doesn't list scores 0 from it. 0 overall means "no signal".
 */
export function blendScore(
  scores: Partial<Record<SongProvider, number>>,
  known: readonly SongProvider[],
): number {
  const used = known.filter((p) => PROVIDER_WEIGHTS[p] > 0);
  const weight = used.reduce((sum, p) => sum + PROVIDER_WEIGHTS[p], 0);
  if (weight === 0) return 0;
  return used.reduce((sum, p) => sum + PROVIDER_WEIGHTS[p] * (scores[p] ?? 0), 0) / weight;
}

/**
 * How much of the show each artist gets (D-065). Pure.
 * `weight = tierWeight × popularityFactor`, normalised over the lineup, with a song floor for
 * everyone and a 40% cap for any one artist of a multi-artist event.
 */
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";

export const TIER_WEIGHTS: Record<BillingTier, number> = {
  headliner: 10,
  sub: 5,
  mid: 2.5,
  support: 1,
};

/** Planning length of one song, used for floors and the UI estimate (real fills use real durations). */
export const AVG_SONG_MINUTES = 3.75;
export const AVG_SONG_MS = AVG_SONG_MINUTES * 60_000;

/** Last.fm listener counts mapped onto 0.6–1.6 on a log scale; unknown is 1.0 (tier decides). */
export const POPULARITY_RANGE = {
  minFactor: 0.6,
  maxFactor: 1.6,
  lowListeners: 1_000,
  highListeners: 2_000_000,
};

/** One artist can't take more than this share of a multi-artist event. */
export const MAX_ARTIST_SHARE = 0.4;

export function popularityFactor(listeners: number | null): number {
  if (listeners === null || !Number.isFinite(listeners) || listeners < 0) return 1;
  const { minFactor, maxFactor, lowListeners, highListeners } = POPULARITY_RANGE;
  const lo = Math.log10(lowListeners);
  const hi = Math.log10(highListeners);
  const t = (Math.log10(Math.max(listeners, 1)) - lo) / (hi - lo);
  return minFactor + (maxFactor - minFactor) * Math.min(1, Math.max(0, t));
}

export type PlannedArtistInput = { tier: BillingTier; listeners: number | null };
export type ArtistBudget = { minutes: number; songs: number };

/**
 * Splits `totalMinutes` over the artists (same order as given). Single-artist shows give the
 * artist everything. Others: proportional to weight, then artists under the floor are raised to
 * it and artists over the cap are held at it, and the rest is shared again until it settles.
 */
export function planPlaylist(input: {
  artists: readonly PlannedArtistInput[];
  totalMinutes: number;
  isSingleArtist: boolean;
}): ArtistBudget[] {
  const { artists, totalMinutes: total } = input;
  const n = artists.length;
  if (n === 0) return [];
  if (input.isSingleArtist || n === 1) {
    const minutes = total / n;
    return artists.map(() => ({ minutes, songs: songsFor(minutes, 1) }));
  }

  // "2 songs each, or 1 if the lineup is huge": huge = the floors alone would fill half the show.
  const floorSongs = 2 * n * AVG_SONG_MINUTES <= total / 2 ? 2 : 1;
  const floor = Math.min(floorSongs * AVG_SONG_MINUTES, total / n);
  const cap = Math.max(MAX_ARTIST_SHARE, 1 / n) * total;
  const weights = artists.map((a) => TIER_WEIGHTS[a.tier] * popularityFactor(a.listeners));
  const minutes = allocate(weights, total, floor, cap);
  return minutes.map((m) => ({ minutes: m, songs: songsFor(m, floorSongs) }));
}

/**
 * Water-filling: hold artists over the cap at the cap first (that frees time for the rest),
 * then raise artists under the floor; re-share the remainder after each change. Doing one
 * kind per round keeps every minute allocated.
 */
function allocate(weights: number[], total: number, floor: number, cap: number): number[] {
  const fixed = new Map<number, number>();
  for (let round = 0; round <= weights.length; round++) {
    const free = weights.map((_, i) => i).filter((i) => !fixed.has(i));
    const remaining = total - [...fixed.values()].reduce((a, b) => a + b, 0);
    const weightSum = free.reduce((sum, i) => sum + weights[i]!, 0);
    const share = (i: number) => (weightSum > 0 ? (remaining * weights[i]!) / weightSum : 0);
    const under = free.filter((i) => share(i) < floor);
    const over = free.filter((i) => share(i) > cap);
    if (under.length === 0 && over.length === 0) {
      return weights.map((_, i) => fixed.get(i) ?? share(i));
    }
    if (over.length > 0) for (const i of over) fixed.set(i, cap);
    else for (const i of under) fixed.set(i, floor);
  }
  return weights.map((_, i) => fixed.get(i) ?? 0);
}

const songsFor = (minutes: number, floorSongs: number) =>
  Math.max(floorSongs, Math.round(minutes / AVG_SONG_MINUTES));

export type PlaylistEstimate = {
  songs: number;
  minutes: number;
  perTier: { tier: BillingTier; artists: number; songs: number; minutes: number }[];
};

/** The UI preview: the same plan the build fills, summed (D-065). */
export function summarizePlan(
  artists: readonly { tier: BillingTier }[],
  budgets: readonly ArtistBudget[],
): PlaylistEstimate {
  const perTier = BILLING_TIERS.map((tier) => {
    const idx = artists.flatMap((a, i) => (a.tier === tier ? [i] : []));
    return {
      tier,
      artists: idx.length,
      songs: idx.reduce((s, i) => s + (budgets[i]?.songs ?? 0), 0),
      minutes: Math.round(idx.reduce((s, i) => s + (budgets[i]?.minutes ?? 0), 0)),
    };
  }).filter((t) => t.artists > 0);
  return {
    songs: perTier.reduce((s, t) => s + t.songs, 0),
    minutes: Math.round(budgets.reduce((s, b) => s + b.minutes, 0)),
    perTier,
  };
}

/**
 * Takes songs from the ranked pool, in order, until the budget is used. A song that would
 * overshoot the budget by more than half its own length is not added, and filling stops there.
 * At least `minSongs` are taken when the pool has them.
 */
export function fillToBudget<T extends { durationMs?: number }>(
  pool: readonly T[],
  budgetMs: number,
  minSongs = 1,
): T[] {
  const out: T[] = [];
  let used = 0;
  for (const track of pool) {
    const d = track.durationMs && track.durationMs > 0 ? track.durationMs : AVG_SONG_MS;
    if (out.length >= minSongs && (used >= budgetMs || used + d - budgetMs > d / 2)) break;
    out.push(track);
    used += d;
  }
  return out;
}

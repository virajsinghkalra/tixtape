/**
 * How much of the show each artist gets: D-093 tier minutes (amending D-065's weights), with
 * Last.fm popularity moving artists only within their tier. Pure.
 */
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";

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
 * D-093: minutes per artist by billing tier, before popularity. The middle of each range is
 * the target; popularity moves an artist within its range only.
 */
export const TIER_MINUTES: Record<BillingTier, { min: number; max: number }> = {
  headliner: { min: 60, max: 90 },
  sub: { min: 40, max: 50 },
  mid: { min: 25, max: 35 },
  support: { min: 15, max: 20 },
};
/** Every playlist is at least an hour (D-093). */
export const MIN_PLAYLIST_MINUTES = 60;
/** Two-artist shows: ≥ 2 h in all, the headliner 60–90 min and the other act 30–45 min. */
export const TWO_ARTIST_MINUTES = { total: 120, second: { min: 30, max: 45 } } as const;
/** When a festival's tier targets exceed the show, tiers shrink bottom-up to these floors. */
export const SHRINK_FLOOR_MINUTES: Record<BillingTier, number> = {
  headliner: 45,
  sub: 20,
  mid: 10,
  support: 2 * AVG_SONG_MINUTES,
};

const mid = (r: { min: number; max: number }) => (r.min + r.max) / 2;
const clamp = (x: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, x));

/**
 * D-093 plan, per artist in the given order:
 * - 1 artist: the whole show (default solo show 2 h 30 m), never under an hour.
 * - 2 artists: headliner 60–90 min, the other 30–45 min, at least 2 h together.
 * - 3+: each artist's tier target (headliner 60–90, sub 40–50, mid 25–35, support 15–20),
 *   with popularity (D-065 factor) moving artists only within their tier's range. The total
 *   is capped at the real show length: support shrinks first, then mid, then sub, then
 *   headliners, never below the tier floors (headliners ≥ 45 min). Never N × 1 h.
 * - Always ≥ 60 minutes in all.
 */
export function planPlaylist(input: {
  artists: readonly PlannedArtistInput[];
  totalMinutes: number;
  isSingleArtist: boolean;
}): ArtistBudget[] {
  const { artists } = input;
  const n = artists.length;
  if (n === 0) return [];
  const minutes =
    input.isSingleArtist || n === 1
      ? artists.map(() => Math.max(MIN_PLAYLIST_MINUTES, input.totalMinutes) / n)
      : n === 2
        ? twoArtists(artists)
        : capToShow(tierTargets(artists), artists, input.totalMinutes);
  const raised = raiseToFloor(minutes, artists);
  const floorSongs = n * 2 * AVG_SONG_MINUTES <= raised.reduce((a, b) => a + b, 0) ? 2 : 1;
  return raised.map((m) => ({ minutes: m, songs: songsFor(m, floorSongs) }));
}

/** Each tier's target, with popularity moving artists within the tier's range. */
function tierTargets(artists: readonly PlannedArtistInput[]): number[] {
  const factors = artists.map((a) => popularityFactor(a.listeners));
  return artists.map((a, i) => {
    const peers = artists.flatMap((b, j) => (b.tier === a.tier ? [factors[j]!] : []));
    const mean = peers.reduce((x, y) => x + y, 0) / peers.length;
    const range = TIER_MINUTES[a.tier];
    return clamp(mid(range) * (factors[i]! / mean), range);
  });
}

/** The billed headliner (highest tier, first) gets 60–90 min; the other act 30–45 min. */
function twoArtists(artists: readonly PlannedArtistInput[]): number[] {
  const [a, b] = artists as [PlannedArtistInput, PlannedArtistInput];
  const firstIsMain = BILLING_TIERS.indexOf(a.tier) <= BILLING_TIERS.indexOf(b.tier);
  const ranges = firstIsMain
    ? [TIER_MINUTES.headliner, TWO_ARTIST_MINUTES.second]
    : [TWO_ARTIST_MINUTES.second, TIER_MINUTES.headliner];
  const targets = artists.map((x, i) => {
    const r = ranges[i]!;
    const share = popularityFactor(x.listeners);
    return clamp(mid(r) * share, r);
  });
  // Grow both within their ranges until the pair reaches 2 h.
  const total = targets[0]! + targets[1]!;
  if (total >= TWO_ARTIST_MINUTES.total) return targets;
  const room = ranges.map((r, i) => r.max - targets[i]!);
  const roomSum = room[0]! + room[1]!;
  const grow = Math.min(TWO_ARTIST_MINUTES.total - total, roomSum);
  return targets.map((t, i) => t + (roomSum > 0 ? (grow * room[i]!) / roomSum : 0));
}

/** Shrinks tiers bottom-up (support → mid → sub → headliner) until the show length fits. */
function capToShow(
  targets: number[],
  artists: readonly PlannedArtistInput[],
  showMinutes: number,
): number[] {
  const out = [...targets];
  let excess = out.reduce((a, b) => a + b, 0) - Math.max(showMinutes, MIN_PLAYLIST_MINUTES);
  for (const tier of [...BILLING_TIERS].reverse()) {
    if (excess <= 0) break;
    const idx = artists.flatMap((a, i) => (a.tier === tier ? [i] : []));
    const floor = SHRINK_FLOOR_MINUTES[tier];
    const room = idx.reduce((sum, i) => sum + Math.max(0, out[i]! - floor), 0);
    if (room <= 0) continue;
    const take = Math.min(excess, room);
    for (const i of idx) out[i] = out[i]! - (take * Math.max(0, out[i]! - floor)) / room;
    excess -= take;
  }
  if (excess > 0) {
    // Even the floors don't fit (a huge lineup): headliners keep their floor; everyone else
    // scales down evenly, but never below one song (so the show may run slightly over).
    const others = artists.flatMap((a, i) => (a.tier === "headliner" ? [] : [i]));
    const othersTotal = others.reduce((sum, i) => sum + out[i]!, 0);
    const scale = othersTotal > 0 ? Math.max(0, (othersTotal - excess) / othersTotal) : 0;
    for (const i of others) out[i] = Math.max(AVG_SONG_MINUTES, out[i]! * scale);
  }
  return out;
}

/** Below an hour in all, the headliners (or everyone, if none) take the difference. */
function raiseToFloor(minutes: number[], artists: readonly PlannedArtistInput[]): number[] {
  const total = minutes.reduce((a, b) => a + b, 0);
  if (total >= MIN_PLAYLIST_MINUTES) return minutes;
  const top = artists.flatMap((a, i) => (a.tier === artists[0]!.tier ? [i] : []));
  const extra = (MIN_PLAYLIST_MINUTES - total) / top.length;
  return minutes.map((m, i) => (top.includes(i) ? m + extra : m));
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

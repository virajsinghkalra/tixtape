/**
 * Event popularity (D-047 §4): an exponentially decayed score with a 7-day half-life,
 * bumped by engagement. The SQL upsert uses the same constants.
 */
export const TREND_HALF_LIFE_MS = 7 * 86_400_000;

export const ENGAGEMENT_WEIGHTS = { view: 1, search_click: 3, playlist_open: 5 } as const;
export type EngagementKind = keyof typeof ENGAGEMENT_WEIGHTS;

/** The score as of `now`; a timestamp in the future counts as no time passed. */
export function decayedTrend(score: number, updatedAt: Date, now: Date): number {
  const age = Math.max(0, now.getTime() - updatedAt.getTime());
  return score * 0.5 ** (age / TREND_HALF_LIFE_MS);
}

export function bumpTrend(score: number, updatedAt: Date, now: Date, kind: EngagementKind): number {
  return decayedTrend(score, updatedAt, now) + ENGAGEMENT_WEIGHTS[kind];
}

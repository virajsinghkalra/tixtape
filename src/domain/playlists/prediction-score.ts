/**
 * Backtest metric for setlist prediction. Pure. Titles compare through `normalizeTrackTitle`,
 * the same key the engine uses to match setlist.fm songs to tracks (D-085).
 */
import { normalizeTrackTitle } from "./track-title";

export type PredictionScore = {
  /** Distinct actual songs that the prediction contains. */
  hits: number;
  /** Distinct songs actually played. */
  actualCount: number;
  /** hits / actualCount (0 when nothing was played). */
  recall: number;
  /** hits / distinct predicted songs (0 when nothing was predicted). */
  precision: number;
};

export function scorePrediction(
  predicted: readonly string[],
  actual: readonly string[],
): PredictionScore {
  const predictedKeys = new Set(predicted.map(normalizeTrackTitle));
  const actualKeys = new Set(actual.map(normalizeTrackTitle));
  let hits = 0;
  for (const key of actualKeys) if (predictedKeys.has(key)) hits++;
  return {
    hits,
    actualCount: actualKeys.size,
    recall: actualKeys.size === 0 ? 0 : hits / actualKeys.size,
    precision: predictedKeys.size === 0 ? 0 : hits / predictedKeys.size,
  };
}

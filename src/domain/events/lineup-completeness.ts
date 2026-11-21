/**
 * D-091: is the stored lineup the whole bill? Festivals published with headliners only
 * (Lollapalooza India 2027 had 4 of ~45 acts) are flagged `lineup_incomplete`. Pure.
 */
import type { EventType } from "@/domain/shared/lineup";

/** A festival bill shorter than this is almost certainly headliners only. */
export const MIN_FESTIVAL_ACTS = 8;
export const LINEUP_INCOMPLETE = "lineup_incomplete" as const;

export type LineupCompleteness = {
  status: "complete" | "incomplete";
  /** Acts we store. */
  stored: number;
  /** The most acts any source names for this event, when known. */
  announced: number | null;
  /** Which source announced that many. */
  source: string | null;
  /** Why it's incomplete, for the admin console; null when complete. */
  reason: string | null;
};

export function lineupCompleteness(input: {
  type: EventType;
  stored: number;
  announced?: number | null;
  source?: string | null;
}): LineupCompleteness {
  const announced = input.announced ?? null;
  const base = { stored: input.stored, announced, source: input.source ?? null };
  if (announced !== null && announced > input.stored) {
    return {
      ...base,
      status: "incomplete",
      reason: `${input.source ?? "a source"} lists ${announced} acts; ${input.stored} stored`,
    };
  }
  if (input.type === "festival" && input.stored < MIN_FESTIVAL_ACTS) {
    return {
      ...base,
      status: "incomplete",
      reason: `a festival with only ${input.stored} act(s) stored (fewer than ${MIN_FESTIVAL_ACTS})`,
    };
  }
  return { ...base, status: "complete", reason: null };
}

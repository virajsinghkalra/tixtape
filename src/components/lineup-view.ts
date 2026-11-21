/** Presentation rules for a lineup: poster tiers and Spotify match states. */
import type { LineupArtist } from "@/application/ports/events";
import { BILLING_TIERS, type BillingTier, type MatchStatus } from "@/domain/shared/lineup";

export const TIER_LABEL: Record<BillingTier, string> = {
  headliner: "Headliners",
  sub: "Sub-headliners",
  mid: "Mid-card",
  support: "Support",
};

export type TierGroup<A> = { tier: BillingTier; artists: A[] };

/** Non-empty tiers, headliners first, artists in billing order within each tier. */
export function groupByTier<A extends Pick<LineupArtist, "tier" | "billingRank">>(
  lineup: readonly A[],
): TierGroup<A>[] {
  return BILLING_TIERS.map((tier) => ({
    tier,
    artists: lineup.filter((a) => a.tier === tier).sort((a, b) => a.billingRank - b.billingRank),
  })).filter((g) => g.artists.length > 0);
}

export type MatchTone = "matched" | "pending" | "review" | "missing";

export const MATCH_STATE: Record<MatchStatus, { tone: MatchTone; label: string }> = {
  auto: { tone: "matched", label: "On Spotify" },
  manual: { tone: "matched", label: "On Spotify" },
  pending: { tone: "pending", label: "Finding on Spotify" },
  needs_review: { tone: "review", label: "Checking the Spotify match" },
  not_found: { tone: "missing", label: "Not found on Spotify" },
};

export function isMatched(status: MatchStatus): boolean {
  return MATCH_STATE[status].tone === "matched";
}

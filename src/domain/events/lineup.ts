/**
 * Lineup rules shared by every source: credit splitting, ordering and the lineup hash.
 */
import { createHash } from "node:crypto";
import type { BillingTier } from "@/domain/shared/lineup";
import { normalizeArtistName, splitArtistCredit } from "@/domain/shared/normalize";
import type { RawLineupEntry } from "./raw-event";

export type LineupEntry = {
  /** One artist's display name (credits like "A b2b B" are already split). */
  name: string;
  normalizedName: string;
  tier: BillingTier;
  /** 1..n with no gaps, in billing order. */
  billingRank: number;
  day: number | null;
  stage: string | null;
};

/**
 * Turns billed credits into one entry per artist, in billing order.
 * - "Nucleya b2b Ritviz" becomes two entries with the credit's tier, kept together.
 * - An artist billed twice (e.g. on two days) keeps its highest billing only, because
 *   event_artists has one row per (event, artist).
 * - Ranks are renumbered 1..n; ties keep input order.
 */
export function buildLineup(entries: readonly RawLineupEntry[]): LineupEntry[] {
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.billingRank - b.entry.billingRank || a.index - b.index);
  const seen = new Set<string>();
  const lineup: LineupEntry[] = [];
  for (const { entry } of ordered) {
    for (const name of splitArtistCredit(entry.name)) {
      const normalizedName = normalizeArtistName(name);
      if (normalizedName === "" || seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      lineup.push({
        name,
        normalizedName,
        tier: entry.tier,
        billingRank: lineup.length + 1,
        day: entry.day ?? null,
        stage: entry.stage ?? null,
      });
    }
  }
  return lineup;
}

/**
 * Stable fingerprint of a lineup: the ordered list of (normalized artist, tier).
 * Changes when an artist is added, removed, reordered or re-tiered; playlists built
 * against an older hash are stale (LLD §5.3). Day and stage changes don't count.
 */
export function lineupHash(lineup: ReadonlyArray<{ name: string; tier: BillingTier }>): string {
  const canonical = JSON.stringify(lineup.map((e) => [normalizeArtistName(e.name), e.tier]));
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Ticketmaster lists `_embedded.attractions` roughly in billing order but has no tiers.
 * Rule (documented in the P1.6 hand-back):
 * - first attraction → headliner;
 * - small bills (≤ 3 acts, a typical concert with openers) → everyone else is support;
 * - larger bills (festivals) → positions 2–3 sub, 4–10 mid, the rest support.
 */
export function tierFromAttractionOrder(index: number, total: number): BillingTier {
  if (index === 0) return "headliner";
  if (total <= 3) return "support";
  if (index <= 2) return "sub";
  if (index <= 9) return "mid";
  return "support";
}

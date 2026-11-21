/** What a build works through, derived from the event's current lineup on every step. */
import { z } from "zod";
import type { EventDetail } from "@/application/ports/events";
import {
  planPlaylist,
  summarizePlan,
  type ArtistBudget,
  type PlaylistEstimate,
} from "@/domain/playlists/budget";
import { eventPerformanceMinutes, type ShowLength } from "@/domain/playlists/show-length";
import type { ArtistId, SpotifyArtistId } from "@/domain/shared/ids";
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";

/** Spotify market for track calls when the venue has no country (the beta is India-only). */
export const DEFAULT_MARKET = "IN";

export type PlannedArtist = {
  /** Our artist row: the song cache is keyed by it (D-080). */
  artistId: ArtistId;
  name: string;
  spotifyId: SpotifyArtistId;
  tier: BillingTier;
  billingRank: number;
};

export type BuildPlan = {
  title: string;
  lineupHash: string | null;
  market: string;
  /** Matched artists, headliners first, then by billing rank. */
  artists: PlannedArtist[];
  /** Lineup artists without a confirmed Spotify match (D-015): skipped and reported. */
  unmatched: string[];
  /** D-065: the real performance time the playlist fills. */
  show: ShowLength;
  isSingleArtist: boolean;
};

/** Verified daily hours, when the event's verification carries them (D-065). */
const VerifiedHours = z.object({ hours: z.string().min(1) });

export function planBuild(event: EventDetail & { verification?: unknown }): BuildPlan {
  const lineup = [...event.lineup].sort(
    (a, b) =>
      BILLING_TIERS.indexOf(a.tier) - BILLING_TIERS.indexOf(b.tier) ||
      a.billingRank - b.billingRank,
  );
  const artists: PlannedArtist[] = [];
  const unmatched: string[] = [];
  for (const a of lineup) {
    if (a.spotifyId) {
      artists.push({
        artistId: a.artistId,
        name: a.name,
        spotifyId: a.spotifyId,
        tier: a.tier,
        billingRank: a.billingRank,
      });
    } else {
      unmatched.push(a.name);
    }
  }
  const isSingleArtist = event.type === "concert" && event.lineup.length === 1;
  const hours = VerifiedHours.safeParse(event.verification);
  return {
    title: event.title,
    lineupHash: event.lineupHash,
    market: event.venue?.country ?? DEFAULT_MARKET,
    artists,
    unmatched,
    isSingleArtist,
    show: eventPerformanceMinutes({
      type: event.type,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      hours: hours.success ? hours.data.hours : null,
      isSingleArtist,
    }),
  };
}

/** Per matched artist (plan order), from popularity in the same order (null = unknown). */
export function budgetsFor(
  plan: BuildPlan,
  popularity: readonly (number | null)[],
): ArtistBudget[] {
  return planPlaylist({
    artists: plan.artists.map((a, i) => ({ tier: a.tier, listeners: popularity[i] ?? null })),
    totalMinutes: plan.show.minutes,
    isSingleArtist: plan.isSingleArtist,
  });
}

export type PlaylistPreview = PlaylistEstimate & {
  showMinutes: number;
  days: number;
  /** Lineup artists not on Spotify yet: they get no songs. */
  unmatched: number;
};

/** The UI preview: the exact plan a build would fill (D-065). */
export function estimateFromPlan(
  plan: BuildPlan,
  popularity: readonly (number | null)[],
): PlaylistPreview {
  return {
    ...summarizePlan(plan.artists, budgetsFor(plan, popularity)),
    showMinutes: plan.show.minutes,
    days: plan.show.days,
    unmatched: plan.unmatched.length,
  };
}

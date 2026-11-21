/**
 * The "Make playlist" preview (D-065): the engine's real plan for the show, from
 * `GET /api/events/:id/playlist/estimate` (or the same call server-side). Pure and tested.
 */
import { z } from "zod";
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";
import { plural, tierLabel } from "./lineup-copy";

const previewSchema = z.object({
  songs: z.number().int().min(0),
  minutes: z.number().min(0),
  perTier: z.array(
    z.object({
      tier: z.enum(BILLING_TIERS),
      artists: z.number().int().min(0),
      songs: z.number().int().min(0),
      minutes: z.number().min(0),
    }),
  ),
  showMinutes: z.number().min(0),
  days: z.number().int().min(1),
  unmatched: z.number().int().min(0),
});
export type PlaylistPreview = z.infer<typeof previewSchema>;
export type TierPreview = PlaylistPreview["perTier"][number];

/** Null for anything unexpected: the panel then shows no numbers rather than invented ones. */
export function parsePreview(raw: unknown): PlaylistPreview | null {
  const parsed = previewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** "45 min", "1 h", "2 h 38 min", "16 h". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "256 songs · about 16 h"; for a solo show "~32 songs · 2 h of Bhuwin". */
export function headline(p: PlaylistPreview, soloName?: string): string {
  if (soloName) return `~${plural(p.songs, "song")} · ${formatDuration(p.minutes)} of ${soloName}`;
  return `${plural(p.songs, "song")} · about ${formatDuration(p.minutes)}`;
}

/** "matches the show (2 days × 8 h)" or "matches the show (3 h)". */
export function showLine(p: PlaylistPreview): string {
  if (p.showMinutes <= 0) return "";
  const perDay = formatDuration(p.showMinutes / p.days);
  return p.days > 1
    ? `matches the show (${p.days} days × ${perDay})`
    : `matches the show (${perDay})`;
}

/**
 * "Headliners: 2 artists · ~28 songs each", "Headliner: ~40 songs"; tiers with nobody are left
 * out, and a solo show has no breakdown at all (the headline already says it).
 */
export function tierLines(
  p: PlaylistPreview,
): { tier: BillingTier; text: string; songs: number }[] {
  const tiers = p.perTier.filter((t) => t.artists > 0);
  if (tiers.reduce((n, t) => n + t.artists, 0) <= 1) return [];
  return tiers.map((t) => ({
    tier: t.tier,
    songs: t.songs,
    text:
      t.artists === 1
        ? `${tierLabel(t.tier, 1)}: ~${plural(t.songs, "song")}`
        : `${tierLabel(t.tier, t.artists)}: ${plural(t.artists, "artist")} · ~${Math.round(t.songs / t.artists)} songs each`,
  }));
}

/** "2 artists not on Spotify yet", or null. */
export function unmatchedLine(p: PlaylistPreview): string | null {
  if (p.unmatched <= 0) return null;
  return `${plural(p.unmatched, "artist")} not on Spotify yet`;
}

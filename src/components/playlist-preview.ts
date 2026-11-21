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
  /** D-080: how many artists' songs are already cached, and the expected build time. */
  readiness: z
    .object({
      cachedArtists: z.number().int().min(0),
      artists: z.number().int().min(0),
      seconds: z.number().min(0),
    })
    .optional(),
});
export type PlaylistPreview = z.infer<typeof previewSchema>;
export type TierPreview = PlaylistPreview["perTier"][number];

/** Null for anything unexpected: the panel then shows no numbers rather than invented ones. */
export function parsePreview(raw: unknown): PlaylistPreview | null {
  const parsed = previewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * True when there's nothing real to show yet: no artist matched on Spotify, or the estimate
 * comes to 0 songs or 0 min. Callers show `pendingLine` and hide "Make playlist" instead.
 * A partial match isn't pending: it shows its real numbers.
 */
export function previewPending(p: PlaylistPreview | null, matched: number, total: number): boolean {
  if (total <= 0) return false;
  return matched <= 0 || (p !== null && (p.songs <= 0 || Math.round(p.minutes) <= 0));
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

/** D-080: "Ready in about 10 s" when songs are cached, else "Takes about 2 min". */
export function readyLine(p: PlaylistPreview): string {
  const r = p.readiness;
  if (!r || r.artists === 0) return "";
  if (r.seconds < 60) return `Ready in about ${Math.max(5, Math.round(r.seconds / 5) * 5)} s`;
  return `Takes about ${Math.round(r.seconds / 60)} min to make`;
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
  // A tier whose artists aren't matched yet has no songs: leave it out, never "~0 songs".
  if (p.perTier.reduce((n, t) => n + t.artists, 0) <= 1) return [];
  const tiers = p.perTier.filter((t) => t.artists > 0 && t.songs > 0);
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

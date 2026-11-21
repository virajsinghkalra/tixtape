/**
 * The engine's plan for the show (D-065), from `GET /api/events/:id/playlist/estimate` (or the
 * same call server-side). D-082: the UI shows no song or minute counts; it only uses the plan to
 * tell "nothing to make yet" (`previewPending`) apart. Pure and tested.
 */
import { z } from "zod";
import { BILLING_TIERS } from "@/domain/shared/lineup";

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

/** Null for anything unexpected: the panel then shows no numbers rather than invented ones. */
export function parsePreview(raw: unknown): PlaylistPreview | null {
  const parsed = previewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * True when there's nothing real to show yet: no artist matched on Spotify, or the estimate
 * comes to 0 songs or 0 min. Callers show `PLAYLIST_SOON` and hide "Make playlist" instead.
 * A partial match isn't pending: "Make playlist" shows.
 */
export function previewPending(p: PlaylistPreview | null, matched: number, total: number): boolean {
  if (total <= 0) return false;
  return matched <= 0 || (p !== null && (p.songs <= 0 || Math.round(p.minutes) <= 0));
}

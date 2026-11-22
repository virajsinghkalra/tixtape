/**
 * Home "Trending now": the upcoming show with a playable playlist that got the most
 * "Open in Spotify" taps lately. Pure; the counts come from analytics (read-only).
 */
type Candidate = { id: string; playlistUrl: string | null };

/**
 * `rows` are upcoming shows soonest first, `opens` maps event id → taps in the window, and
 * `fallback` lists shows in preference order (e.g. the big ones). Most taps wins (ties go to
 * the soonest); with no taps at all, the first playable fallback, then the first playable row.
 */
export function pickTrending<T extends Candidate>(
  rows: readonly T[],
  opens: ReadonlyMap<string, number>,
  fallback: readonly T[] = [],
): T | null {
  let best: T | null = null;
  let bestOpens = 0;
  for (const r of rows) {
    const n = r.playlistUrl ? (opens.get(r.id) ?? 0) : 0;
    if (n > bestOpens) {
      best = r;
      bestOpens = n;
    }
  }
  return best ?? [...fallback, ...rows].find((r) => r.playlistUrl) ?? null;
}

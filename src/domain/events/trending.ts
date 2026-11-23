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

/**
 * Home's "Hot in your city" rail: playable shows in the visitor's city first (most-played,
 * then soonest), topped up from the rest of India the same way. At most `n`, no repeats.
 */
export function pickHotList<T extends Candidate>(
  rows: readonly T[],
  opens: ReadonlyMap<string, number>,
  inCity: (row: T) => boolean,
  n: number,
): { item: T; local: boolean }[] {
  const playable = rows.filter((r) => r.playlistUrl);
  const rank = (list: T[]) =>
    list
      .map((r, i) => ({ r, i, o: opens.get(r.id) ?? 0 }))
      .sort((a, b) => b.o - a.o || a.i - b.i)
      .map((x) => x.r);
  const local = rank(playable.filter(inCity)).map((item) => ({ item, local: true }));
  const rest = rank(playable.filter((r) => !inCity(r))).map((item) => ({ item, local: false }));
  return [...local, ...rest].slice(0, n);
}

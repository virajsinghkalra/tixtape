/**
 * Gig Radio's running order (analysis, 26 Nov: listeners hop across genres and cities like
 * changing stations). One card per playlist (a tour plays once: its date in the visitor's
 * city, else the soonest), your city's gigs this week first, then the hottest, then genres take turns so two of a kind rarely
 * play back to back. Pure.
 */
export type RadioInput = {
  id: string;
  playlistUrl: string | null;
  startsAt: Date;
  local: boolean;
  vibe: string;
  /** Recent Spotify opens: how hot it is. */
  heat: number;
  /** Whole days until the show (0 = today). */
  daysAway: number;
};

export function radioOrder<T extends RadioInput>(rows: T[]): T[] {
  const byPlaylist = new Map<string, T>();
  for (const r of rows) {
    if (!r.playlistUrl) continue;
    const cur = byPlaylist.get(r.playlistUrl);
    const better =
      !cur ||
      (r.local && !cur.local) ||
      (r.local === cur.local && r.startsAt.getTime() < cur.startsAt.getTime());
    if (better) byPlaylist.set(r.playlistUrl, r);
  }
  // Data, 26 Nov: Radio visitors who reached Spotify started on their own city's soonest big
  // gig (Diljit Bengaluru, 3 days out). A local gig this week leads; soon helps everywhere.
  const soon = (r: T) => (r.daysAway <= 7 ? (r.local ? 12 : 2) : 0);
  const score = (r: T) => r.heat * 3 + (r.local ? 4 : 0) + soon(r);
  const ranked = [...byPlaylist.values()].sort(
    (a, b) => score(b) - score(a) || a.startsAt.getTime() - b.startsAt.getTime(),
  );
  // Round-robin by vibe, keeping each vibe's own ranking.
  const queues = new Map<string, T[]>();
  for (const r of ranked) queues.set(r.vibe, [...(queues.get(r.vibe) ?? []), r]);
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < ranked.length) {
    // The best head that isn't the vibe we just played (unless it's the only one left).
    const heads = [...queues].filter(([, q]) => q.length > 0);
    const pick =
      heads
        .filter(([v]) => v !== last || heads.length === 1)
        .sort(([, a], [, b]) => score(b[0]!) - score(a[0]!))[0] ?? heads[0]!;
    out.push(pick[1].shift()!);
    last = pick[0];
  }
  // Your city's hottest gig this week always opens the radio.
  const lead = out.findIndex((r) => r.local && r.daysAway <= 7);
  if (lead > 0) out.unshift(...out.splice(lead, 1));
  return out;
}

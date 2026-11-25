/**
 * Gig Radio's running order (analysis, 26 Nov: listeners hop across genres and cities like
 * changing stations). One card per playlist (a tour plays once: its date in the visitor's
 * city, else the soonest), hottest first, then genres take turns so two of a kind rarely
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
  const score = (r: T) => r.heat * 3 + (r.local ? 4 : 0);
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
  return out;
}

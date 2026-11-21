/**
 * What a visitor keeps on this device (UX #2, #7, #12; D-088). No login, no server state: lists
 * live in localStorage under versioned keys. Unknown shapes are dropped silently, and storage
 * that is missing, full or throwing is never fatal (private mode, blocked site data).
 *
 * "Ping me" on a zero-result search and "Follow" on an artist write the same list: an artist
 * the visitor wants to hear about. A later visit turns their new shows into "just landed".
 */
import { z } from "zod";

export type DeviceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ListSpec<T> = {
  key: string;
  schema: z.ZodType<T>;
  max: number;
  /** Two entries with the same id are the same thing (the newest wins). */
  idOf: (item: T) => string;
};

export const SavedShowSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  /** ISO instant. */
  startsAt: z.string().min(1),
  city: z.string().nullable(),
  savedAt: z.string(),
});
export type SavedShow = z.infer<typeof SavedShowSchema>;

export const FollowedArtistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  followedAt: z.string(),
});
export type FollowedArtist = z.infer<typeof FollowedArtistSchema>;

const IdSchema = z.string().min(1).max(64);

export const artistKey = (name: string) => name.trim().toLowerCase();

export const SAVED: ListSpec<SavedShow> = {
  key: "tixtape.saved.v1",
  schema: SavedShowSchema,
  max: 50,
  idOf: (s) => s.id,
};
export const ARTISTS: ListSpec<FollowedArtist> = {
  key: "tixtape.artists.v1",
  schema: FollowedArtistSchema,
  max: 20,
  idOf: (a) => artistKey(a.name),
};
/** Events the visitor tapped "Remind me" on (the button then reads "Reminded"). */
export const REMINDED: ListSpec<string> = {
  key: "tixtape.reminded.v1",
  schema: IdSchema,
  max: 100,
  idOf: (id) => id,
};
/** "Just landed" cards the visitor has seen or dismissed, by event id. */
export const LANDED_SEEN: ListSpec<string> = {
  key: "tixtape.landed-seen.v1",
  schema: IdSchema,
  max: 200,
  idOf: (id) => id,
};

/** Valid entries only, newest first as stored, de-duplicated, capped. */
export function parseList<T>(spec: ListSpec<T>, raw: string | null): T[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of parsed) {
    const r = spec.schema.safeParse(item);
    if (!r.success) continue;
    const id = spec.idOf(r.data);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r.data);
    if (out.length >= spec.max) break;
  }
  return out;
}

export function readList<T>(spec: ListSpec<T>, storage: DeviceStorage | undefined): T[] {
  try {
    return parseList(spec, storage?.getItem(spec.key) ?? null);
  } catch {
    return [];
  }
}

export function writeList<T>(
  spec: ListSpec<T>,
  list: readonly T[],
  storage: DeviceStorage | undefined,
): void {
  try {
    if (list.length === 0) storage?.removeItem(spec.key);
    else storage?.setItem(spec.key, JSON.stringify(list.slice(0, spec.max)));
  } catch {
    // Full or blocked storage: these lists are a nicety.
  }
}

export function hasItem<T>(spec: ListSpec<T>, list: readonly T[], id: string): boolean {
  return list.some((x) => spec.idOf(x) === id);
}

/** Adds (newest first) or replaces an entry, capped at `max`. */
export function withItem<T>(spec: ListSpec<T>, list: readonly T[], item: T): T[] {
  const id = spec.idOf(item);
  return [item, ...list.filter((x) => spec.idOf(x) !== id)].slice(0, spec.max);
}

export function withoutItem<T>(spec: ListSpec<T>, list: readonly T[], id: string): T[] {
  return list.filter((x) => spec.idOf(x) !== id);
}

/**
 * "Your gigs": saved shows still to come, soonest first. A show counts until the end of its
 * IST day (a date-only show stored at 00:00 IST stays all day). Past ones are "Been there".
 */
export function upcomingSaved(list: readonly SavedShow[], now: Date): SavedShow[] {
  const IST_MS = 330 * 60_000;
  const DAY_MS = 86_400_000;
  const todayStart = Math.floor((now.getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
  return list
    .filter((s) => {
      const t = Date.parse(s.startsAt);
      return Number.isFinite(t) && t >= todayStart;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export type LandedShow = {
  artist: string;
  event: { id: string; title: string; startsAt: string; city: string | null };
};

/**
 * "🎉 X just landed": the first upcoming show for each followed artist that the visitor hasn't
 * seen or saved yet. One per artist, in follow order.
 */
export function landedShows(
  artists: readonly FollowedArtist[],
  showsByArtist: ReadonlyMap<string, readonly LandedShow["event"][]>,
  hidden: ReadonlySet<string>,
): LandedShow[] {
  const out: LandedShow[] = [];
  const used = new Set<string>();
  for (const a of artists) {
    const first = (showsByArtist.get(artistKey(a.name)) ?? []).find(
      (e) => !hidden.has(e.id) && !used.has(e.id),
    );
    if (!first) continue;
    used.add(first.id);
    out.push({ artist: a.name, event: first });
  }
  return out;
}

/** At most this many watched artists are checked per visit (one cheap search each). */
export const MAX_ARTIST_CHECKS = 5;

import { titleStem } from "./front-page";

/** Interim "Listen now" fallback (no Spotify calls): a sibling tour playlist, else artist pages. */
export type SiblingCandidate = {
  eventId: string;
  title: string;
  startsAt: Date;
  /** Spotify URL of the candidate's ready shared playlist. */
  url: string;
  headlinerIds: readonly string[];
};

export type ListenNow = {
  sibling?: { url: string; title: string };
  /** Always playable: the artist's Spotify page, or a Spotify search for an unmatched name. */
  artists: { name: string; spotifyId: string | null; url: string }[];
};

/** No Spotify id yet (matching paused): a Spotify search still lands on the artist. No API call. */
export const spotifyArtistUrl = (name: string, spotifyId: string | null) =>
  spotifyId
    ? `https://open.spotify.com/artist/${spotifyId}`
    : `https://open.spotify.com/search/${encodeURIComponent(name)}`;

const MAX_ARTISTS = 3;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length > 0 && new Set(a).size === new Set(b).size && a.every((id) => new Set(b).has(id));

const stem = (title: string) => titleStem(title).toLowerCase();

/**
 * The sibling to link: same headliner set, same tour stem first, then upcoming dates soonest
 * first, then past ones latest first. null when no candidate qualifies.
 */
export function pickSibling(
  current: { id: string; title: string; headlinerIds: readonly string[] },
  candidates: readonly SiblingCandidate[],
  now: Date,
): { url: string; title: string } | null {
  const mine = stem(current.title);
  const rank = (c: SiblingCandidate) => {
    const t = c.startsAt.getTime();
    return [
      stem(c.title) === mine ? 0 : 1,
      t >= now.getTime() ? 0 : 1,
      Math.abs(t - now.getTime()),
    ];
  };
  const best = candidates
    .filter((c) => c.eventId !== current.id && sameSet(current.headlinerIds, c.headlinerIds))
    .sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      return ra[0]! - rb[0]! || ra[1]! - rb[1]! || ra[2]! - rb[2]!;
    })[0];
  return best ? { url: best.url, title: titleStem(best.title) } : null;
}

/** Top billed artists (billing order), at most three, each with a playable Spotify link. */
export function pickArtists(
  billed: readonly { name: string; spotifyId: string | null }[],
): ListenNow["artists"] {
  return billed.slice(0, MAX_ARTISTS).map((a) => ({
    name: a.name,
    spotifyId: a.spotifyId,
    url: spotifyArtistUrl(a.name, a.spotifyId),
  }));
}

export function buildListenNow(
  current: { id: string; title: string; headlinerIds: readonly string[] },
  billed: readonly { name: string; spotifyId: string | null }[],
  candidates: readonly SiblingCandidate[],
  now: Date,
): ListenNow {
  const sibling = pickSibling(current, candidates, now);
  return sibling ? { sibling, artists: [] } : { artists: pickArtists(billed) };
}

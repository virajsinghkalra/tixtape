/**
 * A song's 30-second preview clip from Apple's public iTunes Search API (no key). Used for
 * "Listen here": phones only let a page start sound from its own tap, which Spotify's embed
 * (another site) can't get, so the first song's preview plays from our page instead.
 */
const SEARCH = "https://itunes.apple.com/search";

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s*[([].*$/u, "")
    .replace(/\s+-\s+.*$/u, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

type Hit = { trackName?: string; artistName?: string; previewUrl?: string };

/** The best preview URL for a song, or null. Never throws. */
export async function findPreviewAudio(
  name: string,
  artist: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const song = fold(name);
  const who = fold(artist);
  if (!song) return null;
  const url = `${SEARCH}?${new URLSearchParams({ term: `${song} ${who}`, entity: "song", limit: "8", country: "IN" })}`;
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    const { results = [] } = (await res.json()) as { results?: Hit[] };
    const ok = (h: Hit) => h.previewUrl?.startsWith("https://");
    const sameArtist = (h: Hit) => {
      const a = fold(h.artistName ?? "");
      return Boolean(who) && (a.includes(who) || who.includes(a));
    };
    const sameSong = (h: Hit) => fold(h.trackName ?? "").startsWith(song);
    const best =
      results.find((h) => ok(h) && sameArtist(h) && sameSong(h)) ??
      results.find((h) => ok(h) && sameArtist(h));
    return best?.previewUrl ?? null;
  } catch {
    return null;
  }
}

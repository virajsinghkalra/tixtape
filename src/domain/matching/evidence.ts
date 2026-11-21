/**
 * Evidence for D-066 strategies, extracted from data the application fetched. Pure.
 */
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";

/** A web page as a search service returned it (structurally the `WebSearch` port's page). */
export type CitingPage = { url: string; title: string; content: string };

/** Long pages are cut before normalizing; the artist and the link sit near the top. */
const MAX_PAGE_CHARS = 100_000;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, "");
  } catch {
    return null;
  }
}

function mentionsAny(page: CitingPage, nameKeys: readonly string[]): boolean {
  const text = ` ${normalizeArtistName(`${page.title} ${page.content}`.slice(0, MAX_PAGE_CHARS))} `;
  return nameKeys.some((key) => key !== "" && text.includes(` ${key} `));
}

/**
 * For each candidate ID, the distinct hosts whose pages name the artist and cite that ID
 * (an `open.spotify.com/artist/<id>` link, or the ID in a stats-site URL such as kworb's).
 * Only candidate IDs count: a random 22-character token can't become a match.
 */
export function webCitations(
  pages: readonly CitingPage[],
  artistNames: readonly string[],
  candidateIds: readonly SpotifyArtistId[],
): Map<SpotifyArtistId, string[]> {
  const nameKeys = [...new Set(artistNames.map(normalizeArtistName))];
  const hosts = new Map<SpotifyArtistId, Set<string>>();
  for (const page of pages) {
    const host = hostOf(page.url);
    if (!host || !mentionsAny(page, nameKeys)) continue;
    const text = `${page.url} ${page.content}`;
    for (const id of candidateIds) {
      if (!text.includes(id)) continue;
      hosts.set(id, (hosts.get(id) ?? new Set()).add(host));
    }
  }
  return new Map([...hosts].map(([id, set]) => [id, [...set].sort()]));
}

/** The year of the newest release ("2024-05-10", "2024-05" or "2024"), or null if none parse. */
export function newestReleaseYear(
  releases: readonly { releaseDate: string | null }[],
): number | null {
  const years = releases
    .map((r) => /^(\d{4})/u.exec(r.releaseDate ?? "")?.[1])
    .filter((y): y is string => y !== undefined)
    .map(Number);
  return years.length === 0 ? null : Math.max(...years);
}

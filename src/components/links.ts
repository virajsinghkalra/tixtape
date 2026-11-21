import type { SpotifyArtistId } from "@/domain/shared/ids";

export const SPOTIFY_LOGIN_URL = "/api/auth/spotify/login";

export function spotifyArtistUrl(id: SpotifyArtistId): string {
  return `https://open.spotify.com/artist/${encodeURIComponent(id)}`;
}

/** The first official page any source gave for the event; that's where "Buy tickets" goes. */
export function ticketUrl(sources: readonly { url: string | null }[]): string | null {
  return sources.find((s) => s.url)?.url ?? null;
}

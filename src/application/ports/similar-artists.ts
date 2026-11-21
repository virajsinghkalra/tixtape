/**
 * Similar artists for zero-result search discovery (UX #7, OD-8, D-088). Implemented by Last.fm
 * `artist.getSimilar` (src/infrastructure/music-signals/lastfm-similar.ts), cached 7 days.
 * Failures throw `UpstreamError`; callers show no "Sounds like this" row.
 */
export interface SimilarArtistSource {
  /** Similar artists' names, most similar first. Empty when the artist is unknown. */
  similarTo(artistName: string): Promise<string[]>;
}

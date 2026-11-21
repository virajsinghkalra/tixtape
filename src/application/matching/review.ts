/**
 * The admin review queue for uncertain matches (LLD §6 step 6, §9).
 */
import type { Artist } from "@/application/ports/artists";
import type { ScoredCandidate } from "@/domain/matching/score";
import type { ArtistId, SpotifyArtistId } from "@/domain/shared/ids";
import { err, ok, type Result } from "@/lib/result";
import { REVIEW_CANDIDATES, scoreArtist, type ResolveDeps } from "./resolve-artist";
import { WebSearchBudget } from "./web-evidence-cache";

export type ReviewItem = {
  artist: Artist;
  /** Best first, with score breakdowns. */
  candidates: ScoredCandidate[];
  /** `searched`: nothing was stored (e.g. after a restart), so Spotify was searched again. */
  candidatesSource: "stored" | "searched";
};

export type ReviewError = "artist_not_found";

export async function listReviewQueue(deps: ResolveDeps, limit: number): Promise<ReviewItem[]> {
  const artists = await deps.artists.listNeedingReview(limit);
  const items: ReviewItem[] = [];
  for (const artist of artists) {
    const stored = await deps.candidateStore.get(artist.id);
    if (stored) {
      items.push({ artist, candidates: stored, candidatesSource: "stored" });
      continue;
    }
    // Re-scoring for display spends no web searches; the resolve job gathers that evidence.
    const { ranked } = await scoreArtist(deps, artist.name, {}, new WebSearchBudget(0));
    const candidates = ranked.slice(0, REVIEW_CANDIDATES);
    await deps.candidateStore.save(artist.id, candidates);
    items.push({ artist, candidates, candidatesSource: "searched" });
  }
  return items;
}

/**
 * An admin confirms the Spotify artist. The alias makes the same lineup name resolve
 * without a search next time. The admin may pick an ID that isn't among the candidates.
 */
export async function approveMatch(
  deps: ResolveDeps,
  artistId: ArtistId,
  spotifyArtistId: SpotifyArtistId,
): Promise<Result<{ artistId: ArtistId; spotifyId: SpotifyArtistId }, ReviewError>> {
  const artist = await deps.artists.findById(artistId);
  if (!artist) return err("artist_not_found");
  const chosen = (await deps.candidateStore.get(artistId))?.find(
    (c) => c.candidate.id === spotifyArtistId,
  );
  await deps.artists.recordMatch(artistId, {
    spotifyId: spotifyArtistId,
    score: chosen?.score ?? null,
    status: "manual",
    imageUrl: chosen?.candidate.imageUrl ?? null,
    resolvedAt: deps.clock.now(),
  });
  await deps.artists.addAlias(artistId, artist.normalizedName);
  await deps.candidateStore.delete(artistId);
  return ok({ artistId, spotifyId: spotifyArtistId });
}

export async function markNotFound(
  deps: ResolveDeps,
  artistId: ArtistId,
): Promise<Result<{ artistId: ArtistId }, ReviewError>> {
  const artist = await deps.artists.findById(artistId);
  if (!artist) return err("artist_not_found");
  await deps.artists.recordMatch(artistId, {
    spotifyId: null,
    score: null,
    status: "not_found",
    imageUrl: null,
    resolvedAt: deps.clock.now(),
  });
  await deps.candidateStore.delete(artistId);
  return ok({ artistId });
}

import type { ScoredCandidate } from "@/domain/matching/score";
import type { ArtistId } from "@/domain/shared/ids";

/**
 * Keeps the scored candidates behind a `needs_review` decision for the admin review screen.
 * There is no column for them yet, so the default store is in memory and the review queue
 * re-searches Spotify when an entry is missing (e.g. after a cold start).
 */
export interface MatchCandidateStore {
  save(artistId: ArtistId, candidates: ScoredCandidate[]): Promise<void>;
  get(artistId: ArtistId): Promise<ScoredCandidate[] | null>;
  delete(artistId: ArtistId): Promise<void>;
}

export function createInMemoryCandidateStore(): MatchCandidateStore {
  const entries = new Map<ArtistId, ScoredCandidate[]>();
  return {
    async save(artistId, candidates) {
      entries.set(artistId, candidates);
    },
    async get(artistId) {
      return entries.get(artistId) ?? null;
    },
    async delete(artistId) {
      entries.delete(artistId);
    },
  };
}

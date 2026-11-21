/**
 * `MatchCandidateStore` backed by `artist_match_candidates` (D-016), so the admin review queue
 * keeps its scored candidates across restarts instead of re-searching Spotify.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { MatchCandidateStore } from "@/application/matching/candidate-store";
import type { Clock } from "@/application/ports/clock";
import type { Database } from "@/db/client";
import { artistMatchCandidates } from "@/db/schema";
import type { ScoredCandidate } from "@/domain/matching/score";
import { asSpotifyArtistId, type ArtistId } from "@/domain/shared/ids";

// The jsonb column is a boundary (ENGINEERING.md §3): validate what comes back.
const scoredCandidates = z.array(
  z.object({
    candidate: z.object({
      id: z.string().transform(asSpotifyArtistId),
      name: z.string(),
      rank: z.number(),
      imageUrl: z.string().nullable(),
      genres: z.array(z.string()),
    }),
    score: z.number(),
    breakdown: z.object({
      nameMatchKind: z.enum(["exact", "diacritics_only", "dj_removed", "none"]),
      nameMatch: z.number(),
      rank: z.number(),
      image: z.number(),
      genre: z.number(),
      externalId: z.number(),
      songOwnership: z.number(),
    }),
  }),
);

export class PgMatchCandidateStore implements MatchCandidateStore {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /** Upsert: re-scoring an artist replaces its candidates. */
  async save(artistId: ArtistId, candidates: ScoredCandidate[]): Promise<void> {
    const scoredAt = this.clock.now();
    await this.db
      .insert(artistMatchCandidates)
      .values({ artistId, candidates, scoredAt })
      .onConflictDoUpdate({
        target: artistMatchCandidates.artistId,
        set: { candidates, scoredAt },
      });
  }

  /** Null when nothing is stored, or the stored JSON no longer has the expected shape. */
  async get(artistId: ArtistId): Promise<ScoredCandidate[] | null> {
    const rows = await this.db
      .select({ candidates: artistMatchCandidates.candidates })
      .from(artistMatchCandidates)
      .where(eq(artistMatchCandidates.artistId, artistId));
    if (!rows[0]) return null;
    const parsed = scoredCandidates.safeParse(rows[0].candidates);
    // A stale shape falls back to a fresh Spotify search, as a cold start would.
    return parsed.success ? parsed.data : null;
  }

  async delete(artistId: ArtistId): Promise<void> {
    await this.db.delete(artistMatchCandidates).where(eq(artistMatchCandidates.artistId, artistId));
  }
}

import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type {
  Artist,
  ArtistMerge,
  ArtistMergeOutcome,
  ArtistRepository,
} from "@/application/ports/artists";
import type { Database } from "@/db/client";
import { artistAliases, artists, artistTrackCache, eventArtists } from "@/db/schema";
import {
  asArtistId,
  asSpotifyArtistId,
  type ArtistId,
  type SpotifyArtistId,
} from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";
import { ConflictError, ValidationError } from "@/lib/errors";
import { isUniqueViolation } from "./pg-errors";

type ArtistRow = typeof artists.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const toArtist = (row: ArtistRow): Artist => ({
  id: asArtistId(row.id),
  name: row.name,
  normalizedName: row.normalizedName,
  spotifyId: row.spotifyId === null ? null : asSpotifyArtistId(row.spotifyId),
  matchScore: row.matchScore,
  matchStatus: row.matchStatus,
  imageUrl: row.imageUrl,
  spotifyResolvedAt: row.spotifyResolvedAt,
});

/** Shared by Events (creates artists from lineups) and Matching (records matches). */
export class PgArtistRepository implements ArtistRepository, ArtistMerge {
  constructor(private readonly db: Database) {}

  /**
   * Serialized per normalized name with a transaction-scoped advisory lock, because
   * `artists.normalized_name` isn't unique and two ingests may see the same new artist.
   */
  async findOrCreateByName(name: string, normalizedName: string): Promise<Artist> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`artist:${normalizedName}`}, 0))`,
      );
      const existing = await this.lookup(tx, normalizedName);
      if (existing) return existing;
      const rows = await tx.insert(artists).values({ name, normalizedName }).returning();
      if (!rows[0]) throw new Error("artists insert returned no row");
      return toArtist(rows[0]);
    });
  }

  async findById(id: ArtistId): Promise<Artist | null> {
    const rows = await this.db.select().from(artists).where(eq(artists.id, id));
    return rows[0] ? toArtist(rows[0]) : null;
  }

  /** An alias row wins; otherwise the oldest artist whose own normalized name matches. */
  async findByAlias(normalizedName: string): Promise<Artist | null> {
    return this.lookup(this.db, normalizedName);
  }

  /** `pending` artists, plus any resolved before `olderThan` (D-009 re-check); never-resolved first. */
  async listNeedingResolution(olderThan: Date, limit: number): Promise<Artist[]> {
    const rows = await this.db
      .select()
      .from(artists)
      .where(
        or(
          eq(artists.matchStatus, "pending"),
          and(isNotNull(artists.spotifyResolvedAt), lt(artists.spotifyResolvedAt, olderThan)),
        ),
      )
      .orderBy(sql`${artists.spotifyResolvedAt} asc nulls first`, asc(artists.createdAt))
      .limit(limit);
    return rows.map(toArtist);
  }

  async listNeedingReview(limit: number): Promise<Artist[]> {
    const rows = await this.db
      .select()
      .from(artists)
      .where(eq(artists.matchStatus, "needs_review"))
      .orderBy(asc(artists.createdAt))
      .limit(limit);
    return rows.map(toArtist);
  }

  async recordMatch(
    id: ArtistId,
    match: {
      spotifyId: SpotifyArtistId | null;
      score: number | null;
      status: MatchStatus;
      imageUrl: string | null;
      resolvedAt: Date;
    },
  ): Promise<void> {
    try {
      await this.db
        .update(artists)
        .set({
          spotifyId: match.spotifyId,
          matchScore: match.score,
          matchStatus: match.status,
          imageUrl: match.imageUrl,
          spotifyResolvedAt: match.resolvedAt,
        })
        .where(eq(artists.id, id));
    } catch (e) {
      if (isUniqueViolation(e, "artists_spotify_id_uq")) {
        throw new ConflictError("Another artist already has this Spotify ID.", { cause: e });
      }
      throw e;
    }
  }

  /** Idempotent for the same artist; `ConflictError` if the alias belongs to another artist. */
  async addAlias(artistId: ArtistId, aliasNormalized: string): Promise<void> {
    await this.db.insert(artistAliases).values({ artistId, aliasNormalized }).onConflictDoNothing();
    const rows = await this.db
      .select({ artistId: artistAliases.artistId })
      .from(artistAliases)
      .where(eq(artistAliases.aliasNormalized, aliasNormalized));
    if (rows[0] && rows[0].artistId !== artistId) {
      throw new ConflictError(`The alias "${aliasNormalized}" already belongs to another artist.`);
    }
  }

  async findBySpotifyId(spotifyId: SpotifyArtistId): Promise<Artist | null> {
    const rows = await this.db.select().from(artists).where(eq(artists.spotifyId, spotifyId));
    return rows[0] ? toArtist(rows[0]) : null;
  }

  /** D-025, ENGINEERING.md §10.4. See `ArtistMerge.mergeInto` for the rules. */
  async mergeInto(duplicateId: ArtistId, canonicalId: ArtistId): Promise<ArtistMergeOutcome> {
    if (duplicateId === canonicalId) {
      throw new ValidationError("An artist can't be merged into itself.");
    }
    return this.db.transaction(async (tx) => {
      // Lock both rows in a fixed order so two opposite merges can't deadlock.
      const locked = await tx
        .select()
        .from(artists)
        .where(inArray(artists.id, [duplicateId, canonicalId]))
        .orderBy(asc(artists.id))
        .for("update");
      const dup = locked.find((r) => r.id === duplicateId);
      const canon = locked.find((r) => r.id === canonicalId);
      if (!dup || !canon) {
        return {
          kind: "not_found",
          missing: [dup ? null : duplicateId, canon ? null : canonicalId].filter(
            (x): x is ArtistId => x !== null,
          ),
        };
      }
      const inherit = spotifyInheritance(dup, canon);
      if (inherit === "conflict") {
        return {
          kind: "spotify_conflict",
          duplicateSpotifyId: dup.spotifyId === null ? null : asSpotifyArtistId(dup.spotifyId),
          canonicalSpotifyId: canon.spotifyId === null ? null : asSpotifyArtistId(canon.spotifyId),
        };
      }
      // Serialize with findOrCreateByName for the duplicate's name, so it can't fork again mid-merge.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`artist:${dup.normalizedName}`}, 0))`,
      );
      const lineup = await moveLineup(tx, duplicateId, canonicalId);
      const aliasesMoved = await moveAliases(tx, dup, canon);
      const trackCacheRowsMoved = inherit ? await inheritMatch(tx, dup, canonicalId) : 0;
      await tx.delete(artists).where(eq(artists.id, duplicateId));
      return { kind: "merged", ...lineup, aliasesMoved, trackCacheRowsMoved };
    });
  }

  private async lookup(db: Database | Tx, normalizedName: string): Promise<Artist | null> {
    const viaAlias = await db
      .select({ artist: artists })
      .from(artistAliases)
      .innerJoin(artists, eq(artists.id, artistAliases.artistId))
      .where(eq(artistAliases.aliasNormalized, normalizedName));
    if (viaAlias[0]) return toArtist(viaAlias[0].artist);
    const direct = await db
      .select()
      .from(artists)
      .where(eq(artists.normalizedName, normalizedName))
      .orderBy(asc(artists.createdAt))
      .limit(1);
    return direct[0] ? toArtist(direct[0]) : null;
  }
}

/**
 * True: the canonical row takes the duplicate's Spotify match (and so its track cache).
 * False: nothing to inherit. "conflict": two different Spotify artists, or the canonical row
 * is a manual "no match" the duplicate contradicts (D-026), so a person must decide.
 */
function spotifyInheritance(dup: ArtistRow, canon: ArtistRow): boolean | "conflict" {
  if (dup.spotifyId === null) return false;
  if (canon.spotifyId !== null) return "conflict";
  return canon.matchStatus === "manual" ? "conflict" : true;
}

/** Re-points the duplicate's lineup rows; where both play one event, keeps the higher billing. */
async function moveLineup(
  tx: Tx,
  duplicateId: ArtistId,
  canonicalId: ArtistId,
): Promise<{ lineupRowsMoved: number; lineupRowsCollapsed: number }> {
  await tx.execute(sql`
    update ${eventArtists} c
    set billing_rank = d.billing_rank, tier = d.tier,
        day = coalesce(c.day, d.day), stage = coalesce(c.stage, d.stage)
    from ${eventArtists} d
    where c.artist_id = ${canonicalId} and d.artist_id = ${duplicateId}
      and d.event_id = c.event_id and d.billing_rank < c.billing_rank`);
  const collapsed = await tx
    .delete(eventArtists)
    .where(
      and(
        eq(eventArtists.artistId, duplicateId),
        sql`exists (select 1 from ${eventArtists} c
                    where c.event_id = ${eventArtists.eventId} and c.artist_id = ${canonicalId})`,
      ),
    )
    .returning({ eventId: eventArtists.eventId });
  const moved = await tx
    .update(eventArtists)
    .set({ artistId: canonicalId })
    .where(eq(eventArtists.artistId, duplicateId))
    .returning({ eventId: eventArtists.eventId });
  return { lineupRowsMoved: moved.length, lineupRowsCollapsed: collapsed.length };
}

/** Moves aliases, and keeps the duplicate's own name findable as an alias of the canonical artist. */
async function moveAliases(tx: Tx, dup: ArtistRow, canon: ArtistRow): Promise<number> {
  const moved = await tx
    .update(artistAliases)
    .set({ artistId: canon.id })
    .where(eq(artistAliases.artistId, dup.id))
    .returning({ alias: artistAliases.aliasNormalized });
  if (dup.normalizedName !== canon.normalizedName) {
    // An alias already owned by a third artist stays with it (aliases are globally unique).
    await tx
      .insert(artistAliases)
      .values({ artistId: canon.id, aliasNormalized: dup.normalizedName })
      .onConflictDoNothing();
  }
  return moved.length;
}

/** The canonical row takes the duplicate's Spotify match and, with it, the duplicate's track cache. */
async function inheritMatch(tx: Tx, dup: ArtistRow, canonicalId: ArtistId): Promise<number> {
  // Free the unique Spotify ID before giving it to the canonical row.
  await tx.update(artists).set({ spotifyId: null }).where(eq(artists.id, dup.id));
  await tx
    .update(artists)
    .set({
      spotifyId: dup.spotifyId,
      matchScore: dup.matchScore,
      matchStatus: dup.matchStatus,
      imageUrl: dup.imageUrl,
      spotifyResolvedAt: dup.spotifyResolvedAt,
    })
    .where(eq(artists.id, canonicalId));
  // The canonical row had no Spotify ID, so any cache it holds is stale: the duplicate's replaces it.
  await tx.delete(artistTrackCache).where(eq(artistTrackCache.artistId, canonicalId));
  const moved = await tx
    .update(artistTrackCache)
    .set({ artistId: canonicalId })
    .where(eq(artistTrackCache.artistId, dup.id))
    .returning({ mode: artistTrackCache.mode });
  return moved.length;
}

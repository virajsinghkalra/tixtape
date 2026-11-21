/**
 * QA-owned in-memory fakes for the Artist Matching ports. Written from the port contracts
 * (src/application/ports/*), not from the dev team's fakes.
 */
import type {
  Artist,
  ArtistMerge,
  ArtistMergeOutcome,
  ArtistRepository,
} from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type {
  ArtistCatalog,
  SpotifyArtistCandidate,
  SpotifyCaller,
} from "@/application/ports/spotify";
import {
  asArtistId,
  asSpotifyArtistId,
  type ArtistId,
  type SpotifyArtistId,
} from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";
import { ConflictError, ValidationError } from "@/lib/errors";

export const NOW = new Date("2026-11-21T12:00:00.000Z");
export const DAY_MS = 24 * 60 * 60 * 1000;

export const fixedClock = (at: Date = NOW): Clock => ({ now: () => new Date(at.getTime()) });

/** 22 base-62 characters, like a real Spotify ID. */
export function sid(seed: string) {
  return asSpotifyArtistId(
    seed
      .replace(/[^A-Za-z0-9]/g, "")
      .padEnd(22, "0")
      .slice(0, 22),
  );
}

export function cand(
  name: string,
  rank: number,
  over: Partial<SpotifyArtistCandidate> = {},
): SpotifyArtistCandidate {
  return {
    id: sid(name + rank),
    name,
    rank,
    imageUrl: "https://i.scdn.co/image/x",
    genres: [],
    ...over,
  };
}

export type CatalogCall = { query: string; caller: SpotifyCaller };

export class FakeCatalog implements ArtistCatalog {
  calls: CatalogCall[] = [];
  constructor(
    public handler: (
      query: string,
      callIndex: number,
    ) => SpotifyArtistCandidate[] | Error = () => [],
  ) {}
  async searchArtists(query: string, caller: SpotifyCaller): Promise<SpotifyArtistCandidate[]> {
    const idx = this.calls.length;
    this.calls.push({ query, caller });
    const r = this.handler(query, idx);
    if (r instanceof Error) throw r;
    return r.map((c) => ({ ...c, genres: [...c.genres] }));
  }
}

let seq = 0;
function uuid(): ArtistId {
  seq += 1;
  return asArtistId(`00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`);
}

/** Mimics the Postgres repo: spotify_id is unique; an alias belongs to one artist. */
export class FakeArtistRepo implements ArtistRepository, ArtistMerge {
  rows = new Map<ArtistId, Artist>();
  aliases = new Map<string, ArtistId>();
  recordCalls: { id: ArtistId; status: MatchStatus; resolvedAt: Date }[] = [];
  mergeCalls: { duplicateId: ArtistId; canonicalId: ArtistId }[] = [];
  needingResolutionArgs: { olderThan: Date; limit: number }[] = [];

  seed(name: string, normalizedName: string, over: Partial<Artist> = {}): Artist {
    const a: Artist = {
      id: uuid(),
      name,
      normalizedName,
      spotifyId: null,
      matchScore: null,
      matchStatus: "pending",
      imageUrl: null,
      spotifyResolvedAt: null,
      ...over,
    };
    this.rows.set(a.id, a);
    return { ...a };
  }

  async findOrCreateByName(name: string, normalizedName: string): Promise<Artist> {
    const hit = [...this.rows.values()].find((r) => r.normalizedName === normalizedName);
    return hit ? { ...hit } : this.seed(name, normalizedName);
  }
  async findById(id: ArtistId) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async findByAlias(normalizedName: string) {
    const id = this.aliases.get(normalizedName);
    return id ? this.findById(id) : null;
  }
  async listNeedingResolution(olderThan: Date, limit: number) {
    this.needingResolutionArgs.push({ olderThan, limit });
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.matchStatus === "pending" ||
          (r.spotifyResolvedAt !== null && r.spotifyResolvedAt < olderThan),
      )
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async listNeedingReview(limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.matchStatus === "needs_review")
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async recordMatch(
    id: ArtistId,
    m: Parameters<ArtistRepository["recordMatch"]>[1],
  ): Promise<void> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`no artist ${id}`);
    if (m.spotifyId !== null) {
      for (const o of this.rows.values()) {
        if (o.id !== id && o.spotifyId === m.spotifyId) {
          throw new ConflictError("Another artist already has this Spotify ID.");
        }
      }
    }
    this.recordCalls.push({ id, status: m.status, resolvedAt: m.resolvedAt });
    this.rows.set(id, {
      ...r,
      spotifyId: m.spotifyId,
      matchScore: m.score,
      matchStatus: m.status,
      imageUrl: m.imageUrl,
      spotifyResolvedAt: m.resolvedAt,
    });
  }
  async addAlias(artistId: ArtistId, aliasNormalized: string): Promise<void> {
    const owner = this.aliases.get(aliasNormalized);
    if (owner && owner !== artistId) {
      throw new ConflictError(`The alias "${aliasNormalized}" already belongs to another artist.`);
    }
    this.aliases.set(aliasNormalized, artistId);
  }
  async findBySpotifyId(spotifyId: SpotifyArtistId): Promise<Artist | null> {
    const r = [...this.rows.values()].find((a) => a.spotifyId === spotifyId);
    return r ? { ...r } : null;
  }
  /** D-025 contract: refuses different Spotify IDs or a manual "no match" canonical row. */
  async mergeInto(duplicateId: ArtistId, canonicalId: ArtistId): Promise<ArtistMergeOutcome> {
    if (duplicateId === canonicalId)
      throw new ValidationError("Can't merge an artist into itself.");
    this.mergeCalls.push({ duplicateId, canonicalId });
    const dup = this.rows.get(duplicateId);
    const canon = this.rows.get(canonicalId);
    if (!dup || !canon) {
      return {
        kind: "not_found",
        missing: [...(dup ? [] : [duplicateId]), ...(canon ? [] : [canonicalId])],
      };
    }
    const differentIds = dup.spotifyId && canon.spotifyId && dup.spotifyId !== canon.spotifyId;
    const manualNoMatch = canon.matchStatus === "manual" && canon.spotifyId === null;
    if (differentIds || manualNoMatch) {
      return {
        kind: "spotify_conflict",
        duplicateSpotifyId: dup.spotifyId,
        canonicalSpotifyId: canon.spotifyId,
      };
    }
    let aliasesMoved = 0;
    for (const [alias, owner] of this.aliases) {
      if (owner === duplicateId) {
        this.aliases.set(alias, canonicalId);
        aliasesMoved++;
      }
    }
    if (!this.aliases.has(dup.normalizedName)) this.aliases.set(dup.normalizedName, canonicalId);
    this.rows.delete(duplicateId);
    if (canon.spotifyId === null && dup.spotifyId !== null) {
      this.rows.set(canonicalId, {
        ...canon,
        spotifyId: dup.spotifyId,
        matchScore: dup.matchScore,
        matchStatus: dup.matchStatus,
        imageUrl: dup.imageUrl,
        spotifyResolvedAt: dup.spotifyResolvedAt,
      });
    }
    return {
      kind: "merged",
      lineupRowsMoved: 0,
      lineupRowsCollapsed: 0,
      aliasesMoved,
      trackCacheRowsMoved: 0,
    };
  }
}

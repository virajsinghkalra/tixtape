/**
 * Resolves lineup artists to Spotify artists (LLD §6, D-009, D-066 multi-strategy).
 */
import type { Artist, ArtistMerge, ArtistRepository } from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type {
  ArtistCatalog,
  SpotifyArtistCandidate,
  SpotifyBlockedInfo,
  TrackCatalog,
} from "@/application/ports/spotify";
import type { WebSearch } from "@/application/ports/web-search";
import {
  DEFAULT_MATCH_POLICY,
  decideMatch,
  type MatchDecision,
  type MatchPolicy,
} from "@/domain/matching/decide";
import { rankCandidates, type MatchContext, type ScoredCandidate } from "@/domain/matching/score";
import { nameVariants, type NameVariant } from "@/domain/matching/variants";
import type { ArtistId, SpotifyArtistId } from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { ConflictError } from "@/lib/errors";
import type { MatchCandidateStore } from "./candidate-store";
import {
  artistQuery,
  gatherEvidence,
  type ArtistRelations,
  type EventContext,
  type EvidenceNote,
} from "./gather-evidence";
import { WebSearchBudget, type WebEvidenceCache } from "./web-evidence-cache";

/** D-009: matches older than this are checked again. */
export const RECHECK_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** D-066: Spotify artist searches per artist, over both rounds. */
export const MAX_ARTIST_SEARCHES = 4;
/** D-066: web searches per run unless configured. */
export const DEFAULT_WEB_SEARCHES_PER_RUN = 20;

export type ResolveDeps = {
  catalog: ArtistCatalog;
  tracks: TrackCatalog;
  /** D-025: duplicates found while resolving are merged into the row holding the ID. */
  artists: ArtistRepository & ArtistMerge;
  clock: Clock;
  candidateStore: MatchCandidateStore;
  webCache: WebEvidenceCache;
  /** D-066: web corroboration. Without it, hard cases stay in review. */
  web?: WebSearch;
  /** D-066: band ↔ member links (MusicBrainz). Optional until an adapter exists. */
  relations?: ArtistRelations;
  webSearchesPerRun?: number;
  policy?: MatchPolicy;
};

/** Scoring context plus the event the artist plays at, for web queries (D-066). */
export type ResolveContext = MatchContext & { event?: EventContext };

/** The candidates kept for the admin review screen (D-066: top 3 with their evidence). */
export const REVIEW_CANDIDATES = 3;

export type ResolveOutcome = {
  artistId: ArtistId;
  status: Exclude<MatchStatus, "pending">;
  spotifyId: SpotifyArtistId | null;
  score: number | null;
  /** `alias`: a confirmed alias answered without calling Spotify. */
  source: "alias" | "search";
  /** The scoring decision; null for alias hits. */
  decision: MatchDecision | null;
  /**
   * D-025: this row duplicated another artist (same alias, or the Spotify ID was already held)
   * and was merged into it and deleted. `spotifyId` and `status` are the canonical artist's.
   */
  duplicateOf: ArtistId | null;
  /** D-066: evidence steps that were skipped or failed (e.g. web budget spent). */
  notes: EvidenceNote[];
};

export type ResolveBatchReport = {
  /** Artists resolved before the batch ended. */
  resolved: number;
  outcomes: ResolveOutcome[];
  /** Artists whose resolution failed for a reason other than a Spotify block; the batch went on. */
  failed: { artistId: ArtistId; message: string }[];
  /** Set when Spotify blocked us (D-006); the batch stopped and the rest waits until then. */
  blockedUntil: Date | null;
};

/** Matches the Spotify adapter's blocked error without importing infrastructure (D-006). */
export function isSpotifyBlocked(e: unknown): e is SpotifyBlockedInfo {
  return typeof e === "object" && e !== null && "resumeAfter" in e && e.resumeAfter instanceof Date;
}

function addCandidates(
  into: Map<SpotifyArtistId, SpotifyArtistCandidate>,
  found: readonly SpotifyArtistCandidate[],
): void {
  for (const candidate of found) {
    const seen = into.get(candidate.id);
    if (!seen || candidate.rank < seen.rank) into.set(candidate.id, candidate);
  }
}

async function searchAll(
  catalog: ArtistCatalog,
  queries: readonly string[],
  into: Map<SpotifyArtistId, SpotifyArtistCandidate>,
): Promise<void> {
  for (const query of queries)
    addCandidates(into, await catalog.searchArtists(query, { kind: "app" }));
}

function roundOneQueries(name: string): string[] {
  return [...new Set([artistQuery(name), normalizeArtistName(name)])].filter(
    (q): q is string => q !== null && q !== "",
  );
}

/** LLD §6 step 4: `artist:"<raw>"` and the normalized name; candidates merged by ID, best rank kept. */
export async function searchCandidates(
  catalog: ArtistCatalog,
  name: string,
): Promise<SpotifyArtistCandidate[]> {
  const found = new Map<SpotifyArtistId, SpotifyArtistCandidate>();
  await searchAll(catalog, roundOneQueries(name), found);
  return [...found.values()];
}

const matchesLineupName = (s: ScoredCandidate) =>
  ["exact", "diacritics_only", "dj_removed"].includes(s.breakdown.nameMatchKind);

type ScoringDeps = Pick<
  ResolveDeps,
  "catalog" | "tracks" | "clock" | "web" | "webCache" | "relations" | "policy"
>;

/**
 * D-066: round one searches the lineup name. Only when nothing matches it does round two
 * search the variants (cleaned-up name, DJ toggle, collab parts) within the search cap.
 */
async function rankWithVariants(
  catalog: ArtistCatalog,
  name: string,
  variants: readonly NameVariant[],
  context: MatchContext,
): Promise<ScoredCandidate[]> {
  const found = new Map<SpotifyArtistId, SpotifyArtistCandidate>();
  const first = roundOneQueries(name);
  await searchAll(catalog, first, found);
  const ranked = rankCandidates(name, [...found.values()], context);
  if (ranked.some(matchesLineupName)) return ranked;
  const second = variants
    .filter((v) => v.kind !== "raw")
    .map((v) => artistQuery(v.name))
    .filter((q): q is string => q !== null && !first.includes(q))
    .slice(0, Math.max(0, MAX_ARTIST_SEARCHES - first.length));
  if (second.length === 0) return ranked;
  await searchAll(catalog, second, found);
  return rankCandidates(name, [...found.values()], context);
}

/** Searches, scores and, while the match is undecided, gathers D-041/D-066 evidence. */
export async function scoreArtist(
  deps: ScoringDeps,
  name: string,
  context: ResolveContext = {},
  budget = new WebSearchBudget(DEFAULT_WEB_SEARCHES_PER_RUN),
): Promise<{ ranked: ScoredCandidate[]; notes: EvidenceNote[] }> {
  const variants = nameVariants(name);
  const { event, ...scoring } = context;
  const ranked = await rankWithVariants(deps.catalog, name, variants, { ...scoring, variants });
  return gatherEvidence(deps, { name, variants, budget, ...(event ? { event } : {}) }, ranked);
}

/**
 * D-025: `artist` duplicates `owner`, which already holds the Spotify ID. Merge it into the
 * owner (lineup rows, aliases; the duplicate row is deleted). A refused merge (`spotify_conflict`,
 * e.g. the owner is a manual "no match", D-026) leaves `artist` in review with nothing claimed.
 */
async function mergeDuplicate(
  deps: ResolveDeps,
  artist: Artist,
  owner: Artist,
  found: Pick<ResolveOutcome, "source" | "decision" | "notes">,
): Promise<ResolveOutcome> {
  const merge = await deps.artists.mergeInto(artist.id, owner.id);
  if (merge.kind === "merged") {
    await deps.candidateStore.delete(artist.id);
    return {
      ...found,
      artistId: artist.id,
      status: owner.matchStatus === "manual" ? "manual" : "auto",
      spotifyId: owner.spotifyId,
      score: owner.matchScore,
      duplicateOf: owner.id,
      notes: [...found.notes, `merged into ${owner.id}`],
    };
  }
  const score = found.decision?.best?.score ?? null;
  await deps.artists.recordMatch(artist.id, {
    spotifyId: null,
    score,
    status: "needs_review",
    imageUrl: null,
    resolvedAt: deps.clock.now(),
  });
  const candidates = found.decision?.candidates.slice(0, REVIEW_CANDIDATES) ?? [];
  if (candidates.length > 0) await deps.candidateStore.save(artist.id, candidates);
  return {
    ...found,
    artistId: artist.id,
    status: "needs_review",
    spotifyId: null,
    score,
    duplicateOf: null,
    notes: [...found.notes, `merge into ${owner.id} refused: ${merge.kind}`],
  };
}

async function resolveFromAlias(deps: ResolveDeps, artist: Artist): Promise<ResolveOutcome | null> {
  const hit = await deps.artists.findByAlias(artist.normalizedName);
  if (!hit?.spotifyId || (hit.matchStatus !== "manual" && hit.matchStatus !== "auto")) return null;
  if (hit.id !== artist.id) {
    return mergeDuplicate(deps, artist, hit, { source: "alias", decision: null, notes: [] });
  }
  await deps.artists.recordMatch(artist.id, {
    spotifyId: hit.spotifyId,
    score: hit.matchScore,
    status: hit.matchStatus,
    imageUrl: hit.imageUrl,
    resolvedAt: deps.clock.now(),
  });
  return {
    artistId: artist.id,
    status: hit.matchStatus,
    spotifyId: hit.spotifyId,
    score: hit.matchScore,
    source: "alias",
    decision: null,
    duplicateOf: null,
    notes: [],
  };
}

export function newWebBudget(deps: Pick<ResolveDeps, "webSearchesPerRun">): WebSearchBudget {
  return new WebSearchBudget(deps.webSearchesPerRun ?? DEFAULT_WEB_SEARCHES_PER_RUN);
}

export async function resolveArtist(
  deps: ResolveDeps,
  artist: Artist,
  context: ResolveContext = {},
  budget: WebSearchBudget = newWebBudget(deps),
): Promise<ResolveOutcome> {
  const fromAlias = await resolveFromAlias(deps, artist);
  if (fromAlias) return fromAlias;

  const { ranked, notes } = await scoreArtist(deps, artist.name, context, budget);
  const decision = decideMatch(artist.name, ranked, deps.policy ?? DEFAULT_MATCH_POLICY);
  // Only an accepted match claims the Spotify ID: `artists.spotify_id` is unique, and two
  // artists awaiting review may share a top candidate.
  const accepted = decision.status === "auto" ? decision.best : null;
  const score = decision.best?.score ?? null;
  try {
    await deps.artists.recordMatch(artist.id, {
      spotifyId: accepted?.candidate.id ?? null,
      score,
      status: decision.status,
      imageUrl: accepted?.candidate.imageUrl ?? null,
      resolvedAt: deps.clock.now(),
    });
  } catch (e) {
    // D-025: another row already holds this Spotify ID, so this row is a duplicate of it.
    if (!(e instanceof ConflictError) || !accepted) throw e;
    const owner = await deps.artists.findBySpotifyId(accepted.candidate.id);
    if (!owner || owner.id === artist.id) throw e;
    return mergeDuplicate(deps, artist, owner, { source: "search", decision, notes });
  }
  if (decision.status === "needs_review") {
    await deps.candidateStore.save(artist.id, decision.candidates.slice(0, REVIEW_CANDIDATES));
  } else {
    await deps.candidateStore.delete(artist.id);
  }
  return {
    artistId: artist.id,
    status: decision.status,
    spotifyId: accepted?.candidate.id ?? null,
    score,
    source: "search",
    decision,
    duplicateOf: null,
    notes,
  };
}

/** The `artist-resolve` job: pending artists plus matches due for the 30-day re-check. */
export async function resolvePendingArtists(
  deps: ResolveDeps,
  limit: number,
): Promise<ResolveBatchReport> {
  const olderThan = new Date(deps.clock.now().getTime() - RECHECK_AFTER_DAYS * DAY_MS);
  const due = await deps.artists.listNeedingResolution(olderThan, limit);
  return resolveEach(
    deps,
    due.map((artist) => ({ artist, context: {} })),
  );
}

/** Resolves artists in order, sharing one web budget; a Spotify block ends the run (D-006). */
export async function resolveEach(
  deps: ResolveDeps,
  work: readonly { artist: Artist; context: ResolveContext }[],
): Promise<ResolveBatchReport> {
  const budget = newWebBudget(deps);
  const report: ResolveBatchReport = { resolved: 0, outcomes: [], failed: [], blockedUntil: null };
  for (const { artist, context } of work) {
    try {
      report.outcomes.push(await resolveArtist(deps, artist, context, budget));
      report.resolved += 1;
    } catch (e) {
      if (isSpotifyBlocked(e)) {
        report.blockedUntil = e.resumeAfter;
        return report;
      }
      report.failed.push({
        artistId: artist.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}

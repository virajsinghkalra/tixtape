/**
 * D-066 evidence steps for an undecided match. Each step runs only while the decision is still
 * open and the leader matches the name, so easy artists cost nothing extra.
 */
import type { TrackCatalog } from "@/application/ports/spotify";
import { AiUnavailableError, type WebPage, type WebSearch } from "@/application/ports/web-search";
import type { Clock } from "@/application/ports/clock";
import {
  DEFAULT_MATCH_POLICY,
  decideMatch,
  needsSongOwnershipCheck,
  wantsEvidence,
  type MatchPolicy,
} from "@/domain/matching/decide";
import { newestReleaseYear, webCitations } from "@/domain/matching/evidence";
import {
  applyActivity,
  applyExternalIds,
  applySongOwnership,
  applyWebLinks,
  type ScoredCandidate,
} from "@/domain/matching/score";
import type { NameVariant } from "@/domain/matching/variants";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import {
  WEB_EVIDENCE_TTL_DAYS,
  type WebEvidenceCache,
  type WebSearchBudget,
} from "./web-evidence-cache";

/** D-041: the market for track and album lookups. */
export const EVIDENCE_MARKET = "IN";
/** D-066: albums are checked for at most this many name-matching candidates. */
const MAX_ACTIVITY_LOOKUPS = 3;
/** Pages from these never carry Spotify artist links, and Meta's terms forbid collection (D-008). */
const EXCLUDED_DOMAINS = ["instagram.com", "facebook.com"] as const;
const DAY_MS = 86_400_000;

/** D-066 step 4: Spotify IDs a relationship source (MusicBrainz) links to a lineup name. */
export interface ArtistRelations {
  linkedSpotifyIds(name: string): Promise<SpotifyArtistId[]>;
}

export type EvidenceDeps = {
  tracks: TrackCatalog;
  clock: Clock;
  web?: WebSearch;
  webCache: WebEvidenceCache;
  relations?: ArtistRelations;
  policy?: MatchPolicy;
};

export type EventContext = { title: string; city: string | null };

export type EvidenceInput = {
  name: string;
  variants: readonly NameVariant[];
  event?: EventContext;
  budget: WebSearchBudget;
};

/** What a step found, for logs and the run report. */
export type EvidenceNote = string;

export function artistQuery(name: string): string | null {
  const quoted = name.replace(/"/gu, "").trim();
  return quoted === "" ? null : `artist:"${quoted}"`;
}

function leaderName(ranked: readonly ScoredCandidate[], fallback: string): string {
  return ranked[0]?.evidence?.matchedName ?? fallback;
}

async function cachedSearch(
  deps: EvidenceDeps & { web: WebSearch },
  query: string,
  budget: WebSearchBudget,
  notes: EvidenceNote[],
): Promise<WebPage[]> {
  const now = deps.clock.now();
  const hit = await deps.webCache.get(query);
  if (hit && now.getTime() - hit.fetchedAt.getTime() < WEB_EVIDENCE_TTL_DAYS * DAY_MS) {
    return hit.pages;
  }
  if (!budget.take()) {
    notes.push(`web search skipped (run budget spent): ${query}`);
    return [];
  }
  try {
    const pages = await deps.web.search(query, {
      maxResults: 10,
      excludeDomains: EXCLUDED_DOMAINS,
    });
    await deps.webCache.set(query, pages, now);
    return pages;
  } catch (e) {
    // Web evidence is optional: without it the match stays in review, which is the safe outcome.
    if (e instanceof AiUnavailableError) budget.exhaust();
    notes.push(`web search failed (${e instanceof Error ? e.message : String(e)}): ${query}`);
    return [];
  }
}

function webQueries(name: string, event: EventContext | undefined): string[] {
  const quoted = name.replace(/"/gu, "");
  const context = event ? ` ${[event.city, event.title].filter(Boolean).join(" ")}` : "";
  return [`"${quoted}" spotify artist`, `"${quoted}" DJ OR artist spotify${context}`];
}

async function withWebLinks(
  deps: EvidenceDeps,
  input: EvidenceInput,
  ranked: ScoredCandidate[],
  notes: EvidenceNote[],
): Promise<ScoredCandidate[]> {
  const web = deps.web;
  if (!web) return ranked;
  const name = leaderName(ranked, input.name);
  const names = [
    name,
    ...input.variants.filter((v) => v.kind !== "collab_part").map((v) => v.name),
  ];
  const ids = ranked.map((s) => s.candidate.id);
  const pages: WebPage[] = [];
  for (const query of webQueries(name, input.event)) {
    pages.push(...(await cachedSearch({ ...deps, web }, query, input.budget, notes)));
    const linked = applyWebLinks(ranked, webCitations(pages, names, ids));
    if ((linked[0]?.breakdown.webLink ?? 0) > 0) return linked;
  }
  return applyWebLinks(ranked, webCitations(pages, names, ids));
}

async function withActivity(
  deps: EvidenceDeps,
  ranked: ScoredCandidate[],
): Promise<ScoredCandidate[]> {
  const named = ranked
    .filter((s) => s.breakdown.nameMatchKind !== "none")
    .slice(0, MAX_ACTIVITY_LOOKUPS);
  const years = new Map<SpotifyArtistId, number | null>();
  for (const s of named) {
    const albums = await deps.tracks.getArtistAlbums(s.candidate.id, EVIDENCE_MARKET, {
      kind: "app",
    });
    years.set(s.candidate.id, newestReleaseYear(albums));
  }
  return applyActivity(ranked, years, deps.clock.now().getUTCFullYear());
}

/**
 * Runs the D-066 evidence steps in cost order until the match is decided: song ownership
 * (1 Spotify call), web citations (search credits, cached), recent activity (≤3 Spotify calls),
 * then MusicBrainz relations when wired.
 */
export async function gatherEvidence(
  deps: EvidenceDeps,
  input: EvidenceInput,
  ranked: ScoredCandidate[],
): Promise<{ ranked: ScoredCandidate[]; notes: EvidenceNote[] }> {
  const policy = deps.policy ?? DEFAULT_MATCH_POLICY;
  const notes: EvidenceNote[] = [];
  const open = (r: ScoredCandidate[]) => wantsEvidence(decideMatch(input.name, r, policy));
  let current = ranked;

  const first = decideMatch(input.name, current, policy);
  const trackQuery = artistQuery(leaderName(current, input.name));
  const ownershipHelps =
    needsSongOwnershipCheck(input.name, current, policy) || first.reason === "needs_evidence";
  if (trackQuery && ownershipHelps) {
    const found = await deps.tracks.searchTracks(trackQuery, EVIDENCE_MARKET, { kind: "app" });
    current = applySongOwnership(current, found);
  }
  if (open(current)) current = await withWebLinks(deps, input, current, notes);
  if (open(current) && current.filter((s) => s.breakdown.nameMatchKind !== "none").length > 1) {
    current = await withActivity(deps, current);
  }
  if (open(current) && deps.relations) {
    const linked = await deps.relations.linkedSpotifyIds(input.name);
    current = applyExternalIds(current, new Set(linked));
  }
  return { ranked: current, notes };
}

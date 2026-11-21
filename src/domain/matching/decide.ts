/**
 * Turns ranked candidates into a match decision (LLD §6 step 6, D-009). Pure.
 */
import { normalizeArtistName } from "@/domain/shared/normalize";
import {
  SCORE_POINTS,
  rankCandidates,
  type ArtistCandidate,
  type MatchContext,
  type ScoredCandidate,
} from "./score";

export type MatchPolicy = {
  autoAcceptScore: number;
  minLeadOverRunnerUp: number;
  /** Names this short (letters and digits, after normalization) always go to review. */
  shortNameMaxLength: number;
  /** Names that collide with many Spotify artists; compared after normalization. */
  ambiguousNames: readonly string[];
};

export const DEFAULT_MATCH_POLICY: MatchPolicy = {
  autoAcceptScore: 70,
  minLeadOverRunnerUp: 15,
  shortNameMaxLength: 3,
  ambiguousNames: [
    "anirudh",
    "shaan",
    "divine",
    "aurora",
    // D-066: common given names or words billed alone on HOME Festival 2026.
    "felix",
    "mali",
    "sazi",
    "special guest",
    "surprise guest",
    "various artists",
    "to be announced",
  ],
};

export type MatchStatusDecision = "auto" | "needs_review" | "not_found";

export type MatchReason =
  | "confident"
  /** D-066: a short or common name, accepted only on independent (web or MusicBrainz) evidence. */
  | "corroborated"
  | "low_score"
  | "small_lead"
  | "ambiguous_name"
  /** D-066: matched a variant name, but nothing strong backs it. */
  | "needs_evidence"
  /** D-066: matched one side of a collaboration, which is a different act. */
  | "collab"
  | "no_candidates";

export type MatchDecision = {
  status: MatchStatusDecision;
  reason: MatchReason;
  /** The top candidate, or null when there were none. */
  best: ScoredCandidate | null;
  /** All candidates, best first, with score breakdowns for the review screen. */
  candidates: ScoredCandidate[];
};

function isAmbiguousName(lineupName: string, policy: MatchPolicy): boolean {
  const key = normalizeArtistName(lineupName);
  if ([...key.replace(/ /gu, "")].length <= policy.shortNameMaxLength) return true;
  return policy.ambiguousNames.some((name) => normalizeArtistName(name) === key);
}

/**
 * D-041: worth one track search only when the top two are within the lead margin, the name
 * isn't forced to review anyway, and the bonus could lift the leader to the accept score.
 * `ranked` must be sorted best first.
 */
export function needsSongOwnershipCheck(
  lineupName: string,
  ranked: readonly ScoredCandidate[],
  policy: MatchPolicy = DEFAULT_MATCH_POLICY,
): boolean {
  const [best, runnerUp] = ranked;
  if (!best || !runnerUp || isAmbiguousName(lineupName, policy)) return false;
  return (
    best.score - runnerUp.score < policy.minLeadOverRunnerUp &&
    best.score + SCORE_POINTS.songOwnership >= policy.autoAcceptScore
  );
}

/** Web or MusicBrainz evidence: found outside Spotify's own search. */
function hasIndependentEvidence(best: ScoredCandidate): boolean {
  return (best.breakdown.webLink ?? 0) > 0 || best.breakdown.externalId > 0;
}

/**
 * D-066 strong evidence for a variant name. Song ownership counts only with at least two
 * credited tracks: one track by "Avneet" says little about whether "Avneet Music" is them.
 */
function hasStrongEvidence(best: ScoredCandidate): boolean {
  const ownsSongs = best.breakdown.songOwnership > 0 && (best.evidence?.ownedTracks ?? 0) >= 2;
  return ownsSongs || hasIndependentEvidence(best);
}

/**
 * D-066: an undecided match whose leader at least matches the name (or a variant) is worth
 * gathering evidence for. Collab parts and name mismatches are not: no evidence makes them right.
 */
export function wantsEvidence(decision: MatchDecision): boolean {
  const kind = decision.best?.breakdown.nameMatchKind;
  return (
    decision.status === "needs_review" &&
    kind !== undefined &&
    kind !== "none" &&
    kind !== "collab_part"
  );
}

/** `ranked` must be sorted best first, as `rankCandidates` returns it. */
export function decideMatch(
  lineupName: string,
  ranked: ScoredCandidate[],
  policy: MatchPolicy = DEFAULT_MATCH_POLICY,
): MatchDecision {
  const [best, runnerUp] = ranked;
  if (!best) return { status: "not_found", reason: "no_candidates", best: null, candidates: [] };
  const review = (reason: MatchReason): MatchDecision => ({
    status: "needs_review",
    reason,
    best,
    candidates: ranked,
  });
  if (best.breakdown.nameMatchKind === "collab_part") return review("collab");
  const clearLead =
    best.score >= policy.autoAcceptScore &&
    (!runnerUp || best.score - runnerUp.score >= policy.minLeadOverRunnerUp);
  if (isAmbiguousName(lineupName, policy)) {
    return clearLead && hasIndependentEvidence(best)
      ? { status: "auto", reason: "corroborated", best, candidates: ranked }
      : review("ambiguous_name");
  }
  if (best.breakdown.nameMatchKind === "variant" && !hasStrongEvidence(best)) {
    return review("needs_evidence");
  }
  if (best.score < policy.autoAcceptScore) return review("low_score");
  if (!clearLead) return review("small_lead");
  return { status: "auto", reason: "confident", best, candidates: ranked };
}

/** Scores, ranks and decides in one call. */
export function matchArtist(
  lineupName: string,
  candidates: readonly ArtistCandidate[],
  context: MatchContext = {},
  policy: MatchPolicy = DEFAULT_MATCH_POLICY,
): MatchDecision {
  return decideMatch(lineupName, rankCandidates(lineupName, candidates, context), policy);
}

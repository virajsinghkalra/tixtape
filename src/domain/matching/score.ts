/**
 * Scores Spotify artist candidates against a lineup name (LLD §6 step 5). Pure.
 * Popularity and followers are gone for new apps (D-007), so search rank is the only popularity proxy.
 */
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";
import type { NameVariant } from "./variants";

/** Structurally the same as the Spotify port's `SpotifyArtistCandidate`; the domain can't import ports. */
export type ArtistCandidate = {
  id: SpotifyArtistId;
  name: string;
  /** 0-based position in search results. */
  rank: number;
  imageUrl: string | null;
  genres: readonly string[];
};

export type MatchContext = {
  /** Genres of the event the artist plays at. Empty or absent: no genre signal. */
  eventGenres?: readonly string[];
  /** Spotify IDs an external source (MusicBrainz, phase 3) links to this artist. */
  externalSpotifyIds?: ReadonlySet<SpotifyArtistId>;
  /** D-066: other names the act may be listed under (`nameVariants`). Raw entries are ignored. */
  variants?: readonly NameVariant[];
};

/**
 * How the candidate's name relates to the lineup name. Exported as values so stored candidates
 * (the D-016 jsonb column) can be validated against the full list.
 * - `variant` (D-066): matches a cleaned-up name ("Dhyan" for "Dhyan Live"); needs strong evidence.
 * - `collab_part` (D-066): matches one side of a collaboration; a different act, never accepted.
 */
export const NAME_MATCH_KINDS = [
  "exact",
  "diacritics_only",
  "dj_removed",
  "variant",
  "collab_part",
  "none",
] as const;
export type NameMatchKind = (typeof NAME_MATCH_KINDS)[number];

export type ScoreBreakdown = {
  nameMatchKind: NameMatchKind;
  nameMatch: number;
  rank: number;
  image: number;
  genre: number;
  externalId: number;
  /** D-041: the candidate credited on the most tracks of a track search for the name. */
  songOwnership: number;
  /** D-066: cited on the web for this artist by more independent sites than any rival. */
  webLink?: number;
  /** D-066: released something recently (newest album or single year). */
  active?: number;
};

/** What the review screen shows next to the points (D-066). */
export type CandidateEvidence = {
  /** The lineup name or variant the candidate's name matched. */
  matchedName?: string;
  /** Tracks crediting this candidate in the D-041 track search. */
  ownedTracks?: number;
  /** Distinct web hosts citing this candidate's Spotify ID for the artist. */
  webHosts?: readonly string[];
  newestReleaseYear?: number | null;
};

export type ScoredCandidate = {
  candidate: ArtistCandidate;
  score: number;
  breakdown: ScoreBreakdown;
  evidence?: CandidateEvidence;
};

export const SCORE_POINTS = {
  exact: 50,
  diacritics_only: 30,
  dj_removed: 25,
  variant: 40,
  collab_part: 25,
  maxRank: 15,
  perRankStep: 1.5,
  image: 20, // D-039: beats imageless same-name duplicate profiles
  genre: 10,
  externalId: 20,
  songOwnership: 20, // D-041: separates same-name duplicates that all have images
  webLink: 30, // D-066: independent sites cite this Spotify ID for the artist
  active: 10, // D-066: released in the last few calendar years
  /** A recent release is within this many calendar years before now. */
  activeWithinYears: 2,
  /** `webLink` needs at least this many distinct hosts citing the ID. */
  minWebHosts: 2,
} as const;

const LEADING_DJ = /^(?:the\s+)?dj[\s.]+(?=\S)/iu;
const LATIN_DIACRITICS = /(?<=\p{Script=Latin})\p{M}+/gu;

/** The diacritics a name carries, in order. Empty for "Beyonce", "́" for "Beyoncé". */
function diacriticSignature(name: string): string {
  return (name.toLowerCase().normalize("NFKD").match(LATIN_DIACRITICS) ?? []).join("");
}

/**
 * Normalization already folds diacritics and a leading "DJ", so equal normalized names are graded
 * by what was folded: nothing (exact), a "DJ" prefix on one side, or diacritics only.
 */
function nameMatchKind(lineupName: string, candidateName: string): NameMatchKind {
  if (normalizeArtistName(lineupName) !== normalizeArtistName(candidateName)) return "none";
  if (LEADING_DJ.test(lineupName.trim()) !== LEADING_DJ.test(candidateName.trim())) {
    return "dj_removed";
  }
  if (diacriticSignature(lineupName) !== diacriticSignature(candidateName)) {
    return "diacritics_only";
  }
  return "exact";
}

function genresOverlap(
  eventGenres: readonly string[],
  candidateGenres: readonly string[],
): boolean {
  const event = eventGenres.map((g) => g.toLowerCase().trim()).filter((g) => g !== "");
  const candidate = candidateGenres.map((g) => g.toLowerCase().trim()).filter((g) => g !== "");
  // Spotify genres are specific ("desi hip hop"); event genres are broad ("hip hop").
  return event.some((e) => candidate.some((c) => c.includes(e) || e.includes(c)));
}

/** The lineup name first; then cleaned-up variants; then collaboration parts. */
function bestNameMatch(
  lineupName: string,
  candidateName: string,
  variants: readonly NameVariant[],
): { kind: NameMatchKind; matchedName?: string } {
  const kind = nameMatchKind(lineupName, candidateName);
  if (kind !== "none") return { kind, matchedName: lineupName };
  const key = normalizeArtistName(candidateName);
  for (const wanted of ["variant", "collab_part"] as const) {
    const hit = variants.find((v) => v.kind === wanted && normalizeArtistName(v.name) === key);
    if (hit) return { kind: wanted, matchedName: hit.name };
  }
  return { kind: "none" };
}

export function scoreCandidate(
  lineupName: string,
  candidate: ArtistCandidate,
  context: MatchContext = {},
): ScoredCandidate {
  const { kind, matchedName } = bestNameMatch(lineupName, candidate.name, context.variants ?? []);
  const breakdown: ScoreBreakdown = {
    nameMatchKind: kind,
    nameMatch: kind === "none" ? 0 : SCORE_POINTS[kind],
    rank: Math.max(0, SCORE_POINTS.maxRank - SCORE_POINTS.perRankStep * candidate.rank),
    image: candidate.imageUrl ? SCORE_POINTS.image : 0,
    genre: genresOverlap(context.eventGenres ?? [], candidate.genres) ? SCORE_POINTS.genre : 0,
    externalId: context.externalSpotifyIds?.has(candidate.id) ? SCORE_POINTS.externalId : 0,
    songOwnership: 0,
  };
  const scored: ScoredCandidate = { candidate, score: totalScore(breakdown), breakdown };
  return matchedName === undefined ? scored : { ...scored, evidence: { matchedName } };
}

function totalScore(b: ScoreBreakdown): number {
  return (
    b.nameMatch +
    b.rank +
    b.image +
    b.genre +
    b.externalId +
    b.songOwnership +
    (b.webLink ?? 0) +
    (b.active ?? 0)
  );
}

type BonusField = "songOwnership" | "webLink" | "active" | "externalId";

/** Sets `field` to `points` on the candidates `wins` picks, records evidence, and re-ranks. */
function applyBonus(
  ranked: readonly ScoredCandidate[],
  field: BonusField,
  wins: (s: ScoredCandidate) => boolean,
  evidenceOf: (s: ScoredCandidate) => CandidateEvidence,
): ScoredCandidate[] {
  return ranked
    .map((s) => {
      const breakdown = { ...s.breakdown, [field]: wins(s) ? SCORE_POINTS[field] : 0 };
      const evidence = { ...s.evidence, ...evidenceOf(s) };
      return { ...s, breakdown, evidence, score: totalScore(breakdown) };
    })
    .sort(byScore);
}

/** The single candidate with strictly the highest positive count, or null on a tie or zero. */
function strictWinner(
  ranked: readonly ScoredCandidate[],
  count: (s: ScoredCandidate) => number,
  minimum = 1,
): SpotifyArtistId | null {
  const counts = ranked.map((s) => ({ id: s.candidate.id, n: count(s) }));
  const most = Math.max(0, ...counts.map((c) => c.n));
  const top = counts.filter((c) => c.n === most);
  return most >= minimum && top.length === 1 ? (top[0]?.id ?? null) : null;
}

/** Highest score first; ties go to the better search rank, then the ID, so order is stable. */
function byScore(a: ScoredCandidate, b: ScoredCandidate): number {
  return (
    b.score - a.score ||
    a.candidate.rank - b.candidate.rank ||
    a.candidate.id.localeCompare(b.candidate.id)
  );
}

/** Highest score first; ties go to the better search rank, then the ID, so order is stable. */
export function rankCandidates(
  lineupName: string,
  candidates: readonly ArtistCandidate[],
  context: MatchContext = {},
): ScoredCandidate[] {
  return candidates.map((c) => scoreCandidate(lineupName, c, context)).sort(byScore);
}

/** The part of a Spotify track the ownership signal needs. */
export type CreditedTrack = { artistIds: readonly SpotifyArtistId[] };

/**
 * D-041: the candidate credited on strictly the most `tracks` gets `songOwnership` points.
 * A tie for the most, or no credits at all, gives nobody the bonus. Returns a re-ranked copy.
 */
export function applySongOwnership(
  ranked: readonly ScoredCandidate[],
  tracks: readonly CreditedTrack[],
): ScoredCandidate[] {
  const owned = (s: ScoredCandidate) =>
    tracks.filter((t) => t.artistIds.includes(s.candidate.id)).length;
  const owner = strictWinner(ranked, owned);
  return applyBonus(
    ranked,
    "songOwnership",
    (s) => s.candidate.id === owner,
    (s) => ({ ownedTracks: owned(s) }),
  );
}

/**
 * D-066: `hostsById` lists the distinct web hosts citing each Spotify ID for this artist
 * (`webCitations`). The one candidate cited by strictly the most hosts, and by at least
 * `minWebHosts`, gets `webLink`. Same-name duplicates are usually cited only by their own page.
 */
export function applyWebLinks(
  ranked: readonly ScoredCandidate[],
  hostsById: ReadonlyMap<SpotifyArtistId, readonly string[]>,
): ScoredCandidate[] {
  const hosts = (s: ScoredCandidate) => hostsById.get(s.candidate.id) ?? [];
  const cited = strictWinner(ranked, (s) => hosts(s).length, SCORE_POINTS.minWebHosts);
  return applyBonus(
    ranked,
    "webLink",
    (s) => s.candidate.id === cited,
    (s) => ({ webHosts: hosts(s) }),
  );
}

/**
 * D-066: candidates whose newest release is from `nowYear` or the `activeWithinYears` before
 * it get `active`. A context signal only: it never counts as strong evidence.
 */
export function applyActivity(
  ranked: readonly ScoredCandidate[],
  newestYearById: ReadonlyMap<SpotifyArtistId, number | null>,
  nowYear: number,
): ScoredCandidate[] {
  const year = (s: ScoredCandidate) => newestYearById.get(s.candidate.id);
  return applyBonus(
    ranked,
    "active",
    (s) => {
      const y = year(s);
      return typeof y === "number" && y >= nowYear - SCORE_POINTS.activeWithinYears;
    },
    (s) => (newestYearById.has(s.candidate.id) ? { newestReleaseYear: year(s) ?? null } : {}),
  );
}

/**
 * D-066 / LLD §6 (P3): candidates an external source (MusicBrainz relationships) links to
 * this artist get `externalId`. Every linked candidate gets it; ties are left to the lead rule.
 */
export function applyExternalIds(
  ranked: readonly ScoredCandidate[],
  linked: ReadonlySet<SpotifyArtistId>,
): ScoredCandidate[] {
  return applyBonus(
    ranked,
    "externalId",
    (s) => linked.has(s.candidate.id) || s.breakdown.externalId > 0,
    () => ({}),
  );
}

/** Review-queue rules for the admin artists screen (P3.5, D-066). */
import { decideMatch } from "@/domain/matching/decide";
import type { ScoredCandidate } from "@/domain/matching/score";

const BASE62_ID = /^[0-9A-Za-z]{22}$/u;

export type SpotifyRef = { ok: true; id: string } | { ok: false; message: string };

/**
 * A pasted Spotify artist: a bare 22-character ID, `spotify:artist:<id>`, or an
 * open.spotify.com artist link (with or without a locale segment or `?si=`).
 */
export function parseSpotifyArtistRef(input: string): SpotifyRef {
  const raw = input.trim();
  if (raw === "") return { ok: false, message: "Paste a Spotify artist link or ID." };
  let id = raw;
  if (raw.startsWith("spotify:")) {
    const [, kind, rest] = raw.split(":");
    if (kind !== "artist")
      return { ok: false, message: "That's not an artist. Paste an artist link." };
    id = rest ?? "";
  } else if (/^https?:\/\//iu.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, message: "That link isn't valid." };
    }
    if (url.hostname !== "open.spotify.com") {
      return { ok: false, message: "Use an open.spotify.com artist link." };
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.indexOf("artist");
    if (at === -1) return { ok: false, message: "That's not an artist. Paste an artist link." };
    id = parts[at + 1] ?? "";
  }
  return BASE62_ID.test(id)
    ? { ok: true, id }
    : { ok: false, message: "A Spotify artist ID is 22 letters and digits." };
}

/**
 * The candidate the resolver's own policy (`decideMatch`, D-009/D-066) would accept on its own:
 * score over the accept line, a clear lead, and not an ambiguous or very short name. Only
 * these may be bulk-approved; everything else needs a person to look.
 */
export function strongCandidateId(
  lineupName: string,
  ranked: readonly ScoredCandidate[],
): string | null {
  const decision = decideMatch(lineupName, [...ranked]);
  if (decision.status !== "auto" || !decision.best) return null;
  // Variant and collaboration matches need evidence beyond the score (D-066).
  const kind = decision.best.breakdown.nameMatchKind;
  return kind === "variant" || kind === "collab_part" || kind === "none"
    ? null
    : decision.best.candidate.id;
}

export function spotifyEmbedUrl(artistId: string): string {
  return `https://open.spotify.com/embed/artist/${encodeURIComponent(artistId)}`;
}

/** What the review screen needs for one candidate; plain data so it can cross to the client. */
export type ReviewCandidateView = {
  spotifyArtistId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  score: number;
  /** Only the signals that scored, plus how the name matched. */
  points: { label: string; value: number }[];
  nameMatchKind: string;
  evidence: string[];
};

export type ReviewArtistView = {
  id: string;
  name: string;
  candidates: ReviewCandidateView[];
  /** Set only when the resolver's policy would accept this candidate on its own. */
  strongId: string | null;
};

const POINT_LABEL: Record<string, string> = {
  nameMatch: "Name",
  rank: "Search rank",
  image: "Has image",
  genre: "Genre fit",
  externalId: "MusicBrainz link",
  songOwnership: "Owns the songs",
  webLink: "Cited on the web",
  active: "Recently active",
};

export const TOP_CANDIDATES = 3;

function evidenceLines(e: ScoredCandidate["evidence"]): string[] {
  if (!e) return [];
  const lines: string[] = [];
  if (e.matchedName) lines.push(`Matched the name “${e.matchedName}”`);
  if (e.ownedTracks !== undefined)
    lines.push(`Credited on ${e.ownedTracks} tracks in a song search`);
  if (e.webHosts && e.webHosts.length > 0) lines.push(`Linked from ${e.webHosts.join(", ")}`);
  if (e.newestReleaseYear) lines.push(`Newest release ${e.newestReleaseYear}`);
  return lines;
}

export function toReviewView(item: {
  artist: { id: string; name: string };
  candidates: readonly ScoredCandidate[];
}): ReviewArtistView {
  return {
    id: item.artist.id,
    name: item.artist.name,
    strongId: strongCandidateId(item.artist.name, item.candidates),
    candidates: item.candidates.slice(0, TOP_CANDIDATES).map((c) => ({
      spotifyArtistId: c.candidate.id,
      name: c.candidate.name,
      imageUrl: c.candidate.imageUrl,
      genres: [...c.candidate.genres],
      score: c.score,
      nameMatchKind: c.breakdown.nameMatchKind,
      points: Object.entries(c.breakdown)
        .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] !== 0)
        .map(([k, value]) => ({ label: POINT_LABEL[k] ?? k, value })),
      evidence: evidenceLines(c.evidence),
    })),
  };
}

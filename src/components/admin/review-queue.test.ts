import { describe, expect, it } from "vitest";
import type { ScoredCandidate, ScoreBreakdown } from "@/domain/matching/score";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { parseSpotifyArtistRef, strongCandidateId, toReviewView } from "./review-queue";

const ID = "4Z8W4fKeB5YxbusRsdQVPb";

describe("parseSpotifyArtistRef", () => {
  it.each([
    ID,
    `  ${ID}  `,
    `spotify:artist:${ID}`,
    `https://open.spotify.com/artist/${ID}`,
    `https://open.spotify.com/artist/${ID}?si=abc123`,
    `https://open.spotify.com/intl-de/artist/${ID}`,
  ])("accepts %s", (input) => {
    expect(parseSpotifyArtistRef(input)).toEqual({ ok: true, id: ID });
  });

  it.each([
    ["", "Paste a Spotify artist link or ID."],
    ["abc", "A Spotify artist ID is 22 letters and digits."],
    [`${ID}x`, "A Spotify artist ID is 22 letters and digits."],
    ["4Z8W4fKeB5YxbusRsdQVP!", "A Spotify artist ID is 22 letters and digits."],
    [`spotify:track:${ID}`, "That's not an artist. Paste an artist link."],
    [`https://open.spotify.com/album/${ID}`, "That's not an artist. Paste an artist link."],
    [`https://evil.example/artist/${ID}`, "Use an open.spotify.com artist link."],
    [`https://open.spotify.com.evil.example/artist/${ID}`, "Use an open.spotify.com artist link."],
  ])("rejects %j", (input, message) => {
    expect(parseSpotifyArtistRef(input)).toEqual({ ok: false, message });
  });
});

function candidate(
  id: string,
  name: string,
  score: number,
  breakdown: Partial<ScoreBreakdown> = {},
  evidence?: ScoredCandidate["evidence"],
): ScoredCandidate {
  return {
    candidate: {
      id: asSpotifyArtistId(id),
      name,
      rank: 0,
      imageUrl: null,
      genres: ["desi hip hop"],
    },
    score,
    breakdown: {
      nameMatchKind: "exact",
      nameMatch: 50,
      rank: 0,
      image: 0,
      genre: 0,
      externalId: 0,
      songOwnership: 0,
      ...breakdown,
    },
    ...(evidence ? { evidence } : {}),
  };
}

describe("strongCandidateId", () => {
  it("is the leader when the resolver's policy would accept it", () => {
    const ranked = [
      candidate("a".repeat(22), "Seedhe Maut", 85),
      candidate("b".repeat(22), "Seedhe", 40),
    ];
    expect(strongCandidateId("Seedhe Maut", ranked)).toBe("a".repeat(22));
  });

  it("is null for a low score, a small lead, an ambiguous name or no candidates", () => {
    expect(
      strongCandidateId("Seedhe Maut", [candidate("a".repeat(22), "Seedhe Maut", 60)]),
    ).toBeNull();
    expect(
      strongCandidateId("Seedhe Maut", [
        candidate("a".repeat(22), "Seedhe Maut", 85),
        candidate("b".repeat(22), "Seedhe Maut", 80),
      ]),
    ).toBeNull();
    expect(strongCandidateId("Divine", [candidate("a".repeat(22), "DIVINE", 95)])).toBeNull();
    expect(strongCandidateId("Seedhe Maut", [])).toBeNull();
  });

  it("is null for a variant or collaboration name match, whatever the score", () => {
    const variant = candidate("a".repeat(22), "Dhyan", 90, { nameMatchKind: "variant" });
    expect(strongCandidateId("Dhyan Live", [variant])).toBeNull();
  });
});

describe("toReviewView", () => {
  it("keeps the top three, only non-zero points, readable evidence and the strong pick", () => {
    const view = toReviewView({
      artist: { id: "artist-1", name: "Seedhe Maut" },
      candidates: [
        candidate(
          "a".repeat(22),
          "Seedhe Maut",
          85,
          { rank: 15, songOwnership: 20 },
          {
            ownedTracks: 7,
            webHosts: ["djmag.com", "rollingstoneindia.com"],
            newestReleaseYear: 2025,
          },
        ),
        candidate("b".repeat(22), "Seedhe", 40),
        candidate("c".repeat(22), "Maut", 30),
        candidate("d".repeat(22), "SM", 10),
      ],
    });
    expect(view.strongId).toBe("a".repeat(22));
    expect(view.candidates).toHaveLength(3);
    expect(view.candidates[0]).toEqual({
      spotifyArtistId: "a".repeat(22),
      name: "Seedhe Maut",
      imageUrl: null,
      genres: ["desi hip hop"],
      score: 85,
      nameMatchKind: "exact",
      points: [
        { label: "Name", value: 50 },
        { label: "Search rank", value: 15 },
        { label: "Owns the songs", value: 20 },
      ],
      evidence: [
        "Credited on 7 tracks in a song search",
        "Linked from djmag.com, rollingstoneindia.com",
        "Newest release 2025",
      ],
    });
  });
});

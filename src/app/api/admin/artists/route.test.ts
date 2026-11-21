import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchingModule } from "@/application/matching";
import { asArtistId, asSpotifyArtistId } from "@/domain/shared/ids";
import { ok, err } from "@/lib/result";
import { UnauthorizedError } from "@/lib/errors";

const guard = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/auth/guards", () => guard);
vi.mock("@/server/matching", () => ({ matching: () => wired.current }));

const { GET } = await import("./route");
const { PATCH } = await import("./[id]/route");

const ARTIST_ID = "6f1c2c1e-6a0e-4d1b-9a43-1c7a7c4c1d10";
const SPOTIFY_ID = "4Z8W4fKeB5YxbusRsdQVPb";

function fakeModule(): MatchingModule {
  return {
    resolveArtist: vi.fn(),
    resolvePendingArtists: vi.fn(),
    resolveEventLineup: vi.fn(),
    listReviewQueue: vi.fn(async () => [
      {
        artist: {
          id: asArtistId(ARTIST_ID),
          name: "Seedhe Maut",
          normalizedName: "seedhe maut",
          spotifyId: null,
          matchScore: 75,
          matchStatus: "needs_review" as const,
          imageUrl: null,
          spotifyResolvedAt: new Date("2026-11-21T10:00:00Z"),
        },
        candidatesSource: "stored" as const,
        candidates: [
          {
            candidate: {
              id: asSpotifyArtistId(SPOTIFY_ID),
              name: "Seedhe Maut",
              rank: 0,
              imageUrl: "img",
              genres: [],
            },
            score: 75,
            breakdown: {
              nameMatchKind: "exact" as const,
              nameMatch: 50,
              rank: 15,
              image: 10,
              genre: 0,
              externalId: 0,
              songOwnership: 0,
            },
          },
        ],
      },
    ]),
    approveMatch: vi.fn(async (artistId, spotifyId) => ok({ artistId, spotifyId })),
    markNotFound: vi.fn(async (artistId) => ok({ artistId })),
  };
}

const ctx = (id = ARTIST_ID) => ({ params: Promise.resolve({ id }) });
const patch = (payload: unknown, id?: string) =>
  PATCH(
    new Request(`http://x/api/admin/artists/${id ?? ARTIST_ID}`, {
      method: "PATCH",
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
    ctx(id),
  );

let matching: MatchingModule;
beforeEach(() => {
  matching = fakeModule();
  wired.current = matching;
  guard.requireAdmin.mockReset().mockResolvedValue({ role: "admin" });
});

describe("GET /api/admin/artists", () => {
  it("returns the review queue with candidate breakdowns", async () => {
    const res = await GET(
      new Request("http://x/api/admin/artists?status=needs_review&limit=5"),
      {},
    );
    expect(res.status).toBe(200);
    expect(matching.listReviewQueue).toHaveBeenCalledWith(5);
    const body = await res.json();
    expect(body.artists[0]).toMatchObject({
      id: ARTIST_ID,
      candidatesSource: "stored",
      spotifyResolvedAt: "2026-11-21T10:00:00.000Z",
      candidates: [{ spotifyArtistId: SPOTIFY_ID, score: 75, breakdown: { nameMatch: 50 } }],
    });
  });

  it.each([
    ["?status=needs_review", 200],
    ["", 400],
    ["?status=auto", 400],
    ["?status=needs_review&limit=0", 400],
    ["?status=needs_review&limit=101", 400],
    ["?status=needs_review&limit=abc", 400],
    ["?status=needs_review&extra=1", 400],
  ])("query %j → %d", async (qs, status) => {
    const res = await GET(new Request(`http://x/api/admin/artists${qs}`), {});
    expect(res.status).toBe(status);
  });

  it("rejects callers who aren't admins before doing any work", async () => {
    guard.requireAdmin.mockRejectedValue(new UnauthorizedError("Sign in"));
    const res = await GET(new Request("http://x/api/admin/artists?status=needs_review"), {});
    expect(res.status).toBe(401);
    expect(matching.listReviewQueue).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/artists/:id", () => {
  it("approves a match", async () => {
    const res = await patch({ action: "approve", spotifyArtistId: SPOTIFY_ID });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      artistId: ARTIST_ID,
      matchStatus: "manual",
      spotifyId: SPOTIFY_ID,
    });
    expect(matching.approveMatch).toHaveBeenCalledWith(ARTIST_ID, SPOTIFY_ID);
  });

  it("marks an artist not found", async () => {
    const res = await patch({ action: "not_found" });
    expect(await res.json()).toEqual({
      artistId: ARTIST_ID,
      matchStatus: "not_found",
      spotifyId: null,
    });
    expect(matching.markNotFound).toHaveBeenCalledWith(ARTIST_ID);
  });

  it.each([
    ["unknown action", { action: "delete" }, ARTIST_ID],
    ["missing Spotify ID", { action: "approve" }, ARTIST_ID],
    ["malformed Spotify ID", { action: "approve", spotifyArtistId: "spotify:artist:x" }, ARTIST_ID],
    ["non-JSON body", "{not json", ARTIST_ID],
    ["non-UUID artist ID", { action: "not_found" }, "artist-1"],
    ["extra key on not_found (D-018)", { action: "not_found", spotifyId: "x" }, ARTIST_ID],
    [
      "extra key on approve (D-018)",
      { action: "approve", spotifyArtistId: SPOTIFY_ID, matchStatus: "auto" },
      ARTIST_ID,
    ],
  ])("returns 400 for a %s", async (_label, payload, id) => {
    const res = await patch(payload, id);
    expect(res.status).toBe(400);
    expect(matching.approveMatch).not.toHaveBeenCalled();
    expect(matching.markNotFound).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown artist", async () => {
    vi.mocked(matching.markNotFound).mockResolvedValue(err("artist_not_found"));
    const res = await patch({ action: "not_found" });
    expect(res.status).toBe(404);
  });

  it("returns 401 without an admin session", async () => {
    guard.requireAdmin.mockRejectedValue(new UnauthorizedError("Sign in"));
    const res = await patch({ action: "not_found" });
    expect(res.status).toBe(401);
    expect(matching.markNotFound).not.toHaveBeenCalled();
  });
});

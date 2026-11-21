import { describe, expect, it } from "vitest";
import { asArtistId, asSpotifyArtistId } from "@/domain/shared/ids";
import { createInMemoryCandidateStore } from "./candidate-store";
import { createInMemoryWebEvidenceCache } from "./web-evidence-cache";
import { createMatchingModule } from "./index";
import { approveMatch, listReviewQueue, markNotFound } from "./review";
import { resolveArtist, type ResolveDeps } from "./resolve-artist";
import {
  FakeArtistCatalog,
  FakeTrackCatalog,
  FakeWebSearch,
  InMemoryArtistRepository,
  fixedClock,
  spotifyArtist,
  tracksBy,
} from "./testing/fakes";

const NOW = new Date("2026-11-21T10:00:00Z");
const twoMauts = {
  "seedhe maut": [spotifyArtist("a", "Seedhe Maut", 0), spotifyArtist("b", "Seedhe Maut", 1)],
};

function setup() {
  const artists = new InMemoryArtistRepository();
  const catalog = new FakeArtistCatalog(twoMauts);
  const tracks = new FakeTrackCatalog();
  const candidateStore = createInMemoryCandidateStore();
  const deps: ResolveDeps = {
    artists,
    catalog,
    tracks,
    candidateStore,
    webCache: createInMemoryWebEvidenceCache(),
    clock: fixedClock(),
  };
  return { artists, catalog, tracks, candidateStore, deps };
}

describe("listReviewQueue", () => {
  it("returns stored candidates without searching again", async () => {
    const { artists, catalog, deps } = setup();
    const artist = artists.add("Seedhe Maut");
    await resolveArtist(deps, artist);
    const searches = catalog.queries.length;
    const [item] = await listReviewQueue(deps, 10);
    expect(catalog.queries.length).toBe(searches);
    expect(item?.candidatesSource).toBe("stored");
    expect(item?.candidates.map((c) => c.candidate.id)).toEqual(["a", "b"]);
    expect(item?.candidates[0]?.breakdown.nameMatchKind).toBe("exact");
  });

  it("searches again when nothing is stored, then caches", async () => {
    const { artists, catalog, deps } = setup();
    artists.add("Seedhe Maut", { matchStatus: "needs_review" });
    const [first] = await listReviewQueue(deps, 10);
    const [second] = await listReviewQueue(deps, 10);
    expect(first?.candidatesSource).toBe("searched");
    expect(first?.candidates).toHaveLength(2);
    expect(second?.candidatesSource).toBe("stored");
    expect(catalog.queries).toHaveLength(2);
  });

  it("applies song ownership when it searches again", async () => {
    const { artists, deps } = setup();
    deps.tracks = new FakeTrackCatalog({ 'artist:"Seedhe Maut"': tracksBy(["b"]) });
    artists.add("Seedhe Maut", { matchStatus: "needs_review" });
    const [item] = await listReviewQueue(deps, 10);
    expect(item?.candidates.map((c) => [c.candidate.id, c.breakdown.songOwnership])).toEqual([
      ["b", 20],
      ["a", 0],
    ]);
  });

  it("spends no web searches when it re-scores for display", async () => {
    const { artists, deps } = setup();
    const web = new FakeWebSearch();
    deps.web = web;
    artists.add("Seedhe Maut", { matchStatus: "needs_review" });
    await listReviewQueue(deps, 10);
    expect(web.queries).toEqual([]);
  });

  it("lists only artists that need review, up to the limit", async () => {
    const { artists, deps } = setup();
    artists.add("Ritviz", { matchStatus: "auto" });
    artists.add("Seedhe Maut", { matchStatus: "needs_review" });
    artists.add("KK", { matchStatus: "needs_review" });
    expect((await listReviewQueue(deps, 10)).map((i) => i.artist.name)).toEqual([
      "Seedhe Maut",
      "KK",
    ]);
    expect(await listReviewQueue(deps, 1)).toHaveLength(1);
  });
});

describe("approveMatch", () => {
  it("records a manual match from the candidates and adds the alias", async () => {
    const { artists, candidateStore, deps } = setup();
    const artist = artists.add("Seedhe Maut");
    await resolveArtist(deps, artist);
    const result = await approveMatch(deps, artist.id, asSpotifyArtistId("b"));
    expect(result).toEqual({ ok: true, value: { artistId: artist.id, spotifyId: "b" } });
    expect(await artists.findById(artist.id)).toMatchObject({
      spotifyId: "b",
      matchStatus: "manual",
      matchScore: 50 + 13.5 + 20,
      imageUrl: "https://i.scdn.co/image/b",
      spotifyResolvedAt: NOW,
    });
    expect((await artists.findByAlias("seedhe maut"))?.id).toBe(artist.id);
    expect(await candidateStore.get(artist.id)).toBeNull();
  });

  it("accepts a Spotify ID that wasn't a candidate", async () => {
    const { artists, deps } = setup();
    const artist = artists.add("Seedhe Maut", { matchStatus: "needs_review" });
    await approveMatch(deps, artist.id, asSpotifyArtistId("other"));
    expect(await artists.findById(artist.id)).toMatchObject({
      spotifyId: "other",
      matchStatus: "manual",
      matchScore: null,
      imageUrl: null,
    });
  });

  it("makes the next resolve answer from the alias", async () => {
    const { artists, catalog, deps } = setup();
    const artist = artists.add("Seedhe Maut");
    await resolveArtist(deps, artist);
    await approveMatch(deps, artist.id, asSpotifyArtistId("a"));
    const searches = catalog.queries.length;
    const again = await resolveArtist(deps, (await artists.findById(artist.id))!);
    expect(again).toMatchObject({ source: "alias", status: "manual", spotifyId: "a" });
    expect(catalog.queries.length).toBe(searches);
  });

  it("returns artist_not_found for an unknown artist", async () => {
    const { deps } = setup();
    expect(await approveMatch(deps, asArtistId("nope"), asSpotifyArtistId("a"))).toEqual({
      ok: false,
      error: "artist_not_found",
    });
  });
});

describe("markNotFound", () => {
  it("clears the match and the stored candidates", async () => {
    const { artists, candidateStore, deps } = setup();
    const artist = artists.add("Seedhe Maut");
    await resolveArtist(deps, artist);
    expect(await markNotFound(deps, artist.id)).toEqual({
      ok: true,
      value: { artistId: artist.id },
    });
    expect(await artists.findById(artist.id)).toMatchObject({
      spotifyId: null,
      matchStatus: "not_found",
      matchScore: null,
      spotifyResolvedAt: NOW,
    });
    expect(await candidateStore.get(artist.id)).toBeNull();
  });

  it("returns artist_not_found for an unknown artist", async () => {
    const { deps } = setup();
    expect(await markNotFound(deps, asArtistId("nope"))).toEqual({
      ok: false,
      error: "artist_not_found",
    });
  });
});

describe("createMatchingModule", () => {
  it("wires the use cases with one shared candidate store", async () => {
    const artists = new InMemoryArtistRepository();
    const catalog = new FakeArtistCatalog(twoMauts);
    const tracks = new FakeTrackCatalog();
    const matching = createMatchingModule({ artists, catalog, tracks, clock: fixedClock() });
    artists.add("Seedhe Maut");
    const report = await matching.resolvePendingArtists(10);
    expect(report.outcomes[0]?.status).toBe("needs_review");
    const [item] = await matching.listReviewQueue(10);
    expect(item?.candidatesSource).toBe("stored");
    const approved = await matching.approveMatch(item!.artist.id, asSpotifyArtistId("a"));
    expect(approved.ok).toBe(true);
    expect(await matching.listReviewQueue(10)).toEqual([]);
    expect((await matching.markNotFound(item!.artist.id)).ok).toBe(true);
  });
});

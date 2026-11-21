import { describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { ConflictError } from "@/lib/errors";
import { createInMemoryCandidateStore } from "./candidate-store";
import { createInMemoryWebEvidenceCache } from "./web-evidence-cache";
import {
  isSpotifyBlocked,
  resolveArtist,
  resolvePendingArtists,
  searchCandidates,
  type ResolveDeps,
} from "./resolve-artist";
import {
  FakeArtistCatalog,
  FakeTrackCatalog,
  InMemoryArtistRepository,
  SpotifyBlockedFake,
  fixedClock,
  spotifyArtist,
  tracksBy,
} from "./testing/fakes";

const NOW = new Date("2026-11-21T10:00:00Z");

function setup(results: ConstructorParameters<typeof FakeArtistCatalog>[0] = {}) {
  const artists = new InMemoryArtistRepository();
  const catalog = new FakeArtistCatalog(results);
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

describe("searchCandidates", () => {
  it("runs both LLD queries and keeps each artist's best rank", async () => {
    const { catalog } = setup({
      'artist:"Prateek Kuhad"': [
        spotifyArtist("a", "Prateek Kuhad", 2),
        spotifyArtist("b", "X", 0),
      ],
      "prateek kuhad": [spotifyArtist("a", "Prateek Kuhad", 0), spotifyArtist("c", "Y", 1)],
    });
    const found = await searchCandidates(catalog, "Prateek Kuhad");
    expect(catalog.queries).toEqual(['artist:"Prateek Kuhad"', "prateek kuhad"]);
    expect(Object.fromEntries(found.map((c) => [c.id, c.rank]))).toEqual({ a: 0, b: 0, c: 1 });
  });

  it.each([
    ['Say "Hi"', ['artist:"Say Hi"', "say hi"]],
    ["!!!", ['artist:"!!!"']],
    ['"', []],
  ])("builds safe queries for %j", async (name, queries) => {
    const { catalog } = setup();
    await searchCandidates(catalog, name);
    expect(catalog.queries).toEqual(queries);
  });
});

describe("resolveArtist", () => {
  it.each([
    {
      label: "auto-accepts a confident match",
      name: "Prateek Kuhad",
      results: { "prateek kuhad": [spotifyArtist("pk", "Prateek Kuhad", 0)] },
      status: "auto",
      spotifyId: "pk",
      stored: false,
    },
    {
      label: "sends a close call to review without claiming an ID",
      name: "Seedhe Maut",
      results: {
        "seedhe maut": [spotifyArtist("a", "Seedhe Maut", 0), spotifyArtist("b", "Seedhe Maut", 1)],
      },
      status: "needs_review",
      spotifyId: null,
      stored: true,
    },
    {
      label: "always reviews a short name",
      name: "KK",
      results: { kk: [spotifyArtist("kk", "KK", 0)] },
      status: "needs_review",
      spotifyId: null,
      stored: true,
    },
    {
      label: "reports not found when Spotify has nothing",
      name: "When Chai Met Toast",
      results: {},
      status: "not_found",
      spotifyId: null,
      stored: false,
    },
  ] as const)("$label", async ({ name, results, status, spotifyId, stored }) => {
    const { artists, candidateStore, deps } = setup(results);
    const artist = artists.add(name);
    const outcome = await resolveArtist(deps, artist);
    expect(outcome).toMatchObject({ status, spotifyId, source: "search" });
    const row = await artists.findById(artist.id);
    expect(row).toMatchObject({ matchStatus: status, spotifyId, spotifyResolvedAt: NOW });
    expect((await candidateStore.get(artist.id)) !== null).toBe(stored);
  });

  it("records the image and score of an accepted match", async () => {
    const { artists, deps } = setup({ ritviz: [spotifyArtist("rv", "Ritviz", 0)] });
    const artist = artists.add("Ritviz (Live)");
    await resolveArtist(deps, artist);
    expect(await artists.findById(artist.id)).toMatchObject({
      matchScore: 85,
      imageUrl: "https://i.scdn.co/image/rv",
    });
  });

  it("uses the event genres when given", async () => {
    const { artists, deps } = setup({
      ritviz: [
        spotifyArtist("a", "Ritviz", 0, { genres: ["indian edm"] }),
        spotifyArtist("b", "Ritviz", 4),
      ],
    });
    const plain = await resolveArtist(deps, artists.add("Ritviz"));
    const withGenre = await resolveArtist(deps, artists.add("Ritviz"), { eventGenres: ["edm"] });
    expect(plain.status).toBe("needs_review");
    expect(withGenre.status).toBe("auto");
  });

  it("answers from a confirmed alias without searching", async () => {
    const { artists, catalog, deps } = setup();
    const confirmed = artists.add("Nucleya", {
      spotifyId: asSpotifyArtistId("nuc"),
      matchStatus: "manual",
      matchScore: 50,
      imageUrl: "img",
    });
    await artists.addAlias(confirmed.id, "nucleya");
    const outcome = await resolveArtist(deps, confirmed);
    expect(catalog.queries).toEqual([]);
    expect(outcome).toMatchObject({ source: "alias", status: "manual", spotifyId: "nuc" });
    expect((await artists.findById(confirmed.id))?.spotifyResolvedAt).toEqual(NOW);
  });

  it.each(["manual", "auto"] as const)(
    "merges a duplicate of a %s alias owner into it, without searching (QA-M-2, D-025)",
    async (ownerStatus) => {
      const { artists, catalog, deps } = setup();
      const owner = artists.add("Daft Punk", {
        spotifyId: asSpotifyArtistId("dp"),
        matchStatus: ownerStatus,
        matchScore: 75,
        imageUrl: "img",
      });
      await artists.addAlias(owner.id, "daft punk");
      const duplicate = artists.add("Daft Punk (Live)");
      const outcome = await resolveArtist(deps, duplicate);
      expect(catalog.queries).toEqual([]);
      expect(outcome).toMatchObject({
        source: "alias",
        status: ownerStatus,
        spotifyId: "dp",
        duplicateOf: owner.id,
      });
      expect(await artists.findById(duplicate.id)).toBeNull();
      expect(artists.merges).toEqual([{ duplicateId: duplicate.id, canonicalId: owner.id }]);
      expect((await artists.findById(owner.id))?.spotifyId).toBe("dp");
    },
  );

  it("merges a new row into the artist already holding the accepted Spotify ID (D-025)", async () => {
    const { artists, candidateStore, deps } = setup({
      "daft punk": [spotifyArtist("dp", "Daft Punk", 0)],
    });
    const owner = artists.add("Daft Punk", {
      spotifyId: asSpotifyArtistId("dp"),
      matchStatus: "auto",
      matchScore: 85,
    });
    // Created before the owner's alias existed, so it never found the owner.
    const duplicate = artists.add("DAFT PUNK!");
    const outcome = await resolveArtist(deps, duplicate);
    expect(outcome).toMatchObject({
      source: "search",
      status: "auto",
      spotifyId: "dp",
      duplicateOf: owner.id,
    });
    expect(outcome.notes).toContain(`merged into ${owner.id}`);
    expect(await artists.findById(duplicate.id)).toBeNull();
    expect((await artists.findByAlias("daft punk"))?.id).toBe(owner.id);
    expect(await candidateStore.get(duplicate.id)).toBeNull();
  });

  it("sends a duplicate to review when the merge is refused (spotify_conflict)", async () => {
    const { artists, candidateStore, deps } = setup({
      "daft punk": [spotifyArtist("dp", "Daft Punk", 0)],
    });
    const owner = artists.add("Daft Punk", {
      spotifyId: asSpotifyArtistId("dp"),
      matchStatus: "auto",
    });
    const duplicate = artists.add("DAFT PUNK!", { spotifyId: asSpotifyArtistId("other") });
    const outcome = await resolveArtist(deps, duplicate);
    expect(outcome).toMatchObject({ status: "needs_review", spotifyId: null, duplicateOf: null });
    expect(outcome.notes).toContain(`merge into ${owner.id} refused: spotify_conflict`);
    expect(await artists.findById(duplicate.id)).toMatchObject({
      matchStatus: "needs_review",
      spotifyId: null,
    });
    expect(await candidateStore.get(duplicate.id)).toHaveLength(1);
  });

  it("rethrows a conflict that isn't about the accepted Spotify ID", async () => {
    const { artists, deps } = setup({ "daft punk": [spotifyArtist("dp", "Daft Punk", 0)] });
    const artist = artists.add("Daft Punk");
    artists.recordMatch = async () => {
      throw new ConflictError("some other unique index");
    };
    await expect(resolveArtist(deps, artist)).rejects.toBeInstanceOf(ConflictError);
  });

  it("re-resolving the alias owner keeps its ID and reports no duplicate", async () => {
    const { artists, deps } = setup();
    const owner = artists.add("Daft Punk", {
      spotifyId: asSpotifyArtistId("dp"),
      matchStatus: "manual",
    });
    await artists.addAlias(owner.id, "daft punk");
    expect(await resolveArtist(deps, owner)).toMatchObject({ spotifyId: "dp", duplicateOf: null });
    expect((await artists.findById(owner.id))?.spotifyId).toBe("dp");
  });

  it("searches when the alias points at an artist without a confirmed match", async () => {
    const { artists, catalog, deps } = setup();
    const unresolved = artists.add("Nucleya", { matchStatus: "not_found" });
    await artists.addAlias(unresolved.id, "nucleya");
    await resolveArtist(deps, unresolved);
    expect(catalog.queries.length).toBeGreaterThan(0);
  });

  it("lets a Spotify block escape and records nothing", async () => {
    const block = new SpotifyBlockedFake(new Date("2026-11-21T12:00:00Z"));
    const { artists, catalog, deps } = setup();
    catalog.failOn('artist:"Ritviz"', block);
    const artist = artists.add("Ritviz");
    await expect(resolveArtist(deps, artist)).rejects.toBe(block);
    expect((await artists.findById(artist.id))?.matchStatus).toBe("pending");
  });
});

describe("resolvePendingArtists", () => {
  it("resolves pending artists and those last checked over 30 days ago", async () => {
    const { artists, deps } = setup({ ritviz: [spotifyArtist("rv", "Ritviz", 0)] });
    const pending = artists.add("Ritviz");
    const stale = artists.add("Anuv Jain", {
      matchStatus: "auto",
      spotifyResolvedAt: new Date("2026-10-22T09:59:59Z"),
    });
    artists.add("Seedhe Maut", {
      matchStatus: "auto",
      spotifyResolvedAt: new Date("2026-10-22T10:00:01Z"),
    });
    const report = await resolvePendingArtists(deps, 10);
    expect(report.outcomes.map((o) => o.artistId)).toEqual([pending.id, stale.id]);
    expect(report).toMatchObject({ resolved: 2, failed: [], blockedUntil: null });
  });

  it("honours the limit", async () => {
    const { artists, deps } = setup();
    ["A1", "B22", "C333"].forEach((n) => artists.add(n));
    expect((await resolvePendingArtists(deps, 2)).resolved).toBe(2);
  });

  it("stops cleanly on a Spotify block and reports progress", async () => {
    const resumeAfter = new Date("2026-11-21T14:00:00Z");
    const { artists, catalog, deps } = setup();
    artists.add("Ritviz");
    const blocked = artists.add("Anuv Jain");
    const untouched = artists.add("Prateek Kuhad");
    catalog.failOn("anuv jain", new SpotifyBlockedFake(resumeAfter));
    const report = await resolvePendingArtists(deps, 10);
    expect(report).toMatchObject({ resolved: 1, blockedUntil: resumeAfter, failed: [] });
    expect((await artists.findById(blocked.id))?.matchStatus).toBe("pending");
    expect((await artists.findById(untouched.id))?.matchStatus).toBe("pending");
    expect(catalog.queries).not.toContain('artist:"Prateek Kuhad"');
  });

  it("resolves a duplicate alias row once, without failing or coming back", async () => {
    const { artists, deps } = setup();
    const owner = artists.add("Daft Punk", {
      spotifyId: asSpotifyArtistId("dp"),
      matchStatus: "manual",
      spotifyResolvedAt: new Date("2026-11-20T00:00:00Z"),
    });
    await artists.addAlias(owner.id, "daft punk");
    artists.add("DAFT PUNK");
    const first = await resolvePendingArtists(deps, 10);
    expect(first).toMatchObject({ resolved: 1, failed: [] });
    expect((await resolvePendingArtists(deps, 10)).resolved).toBe(0);
  });

  it("reports other failures and carries on", async () => {
    const { artists, catalog, deps } = setup();
    const broken = artists.add("Anuv Jain");
    artists.add("Ritviz");
    catalog.failOn("anuv jain", new Error("bad response"));
    const report = await resolvePendingArtists(deps, 10);
    expect(report).toMatchObject({
      resolved: 1,
      failed: [{ artistId: broken.id, message: "bad response" }],
      blockedUntil: null,
    });
  });
});

describe("isSpotifyBlocked", () => {
  it.each([
    [new SpotifyBlockedFake(new Date()), true],
    [{ resumeAfter: new Date(), reason: "quota_exceeded" }, true],
    [{ resumeAfter: "2026-11-21" }, false],
    [new Error("x"), false],
    [null, false],
    ["blocked", false],
  ])("%o → %s", (value, expected) => {
    expect(isSpotifyBlocked(value)).toBe(expected);
  });
});

describe("song ownership track search (D-041)", () => {
  const katseyes = {
    katseye: [spotifyArtist("real", "KATSEYE", 0), spotifyArtist("dupe", "Katseye", 1)],
  };
  const trackQuery = 'artist:"KATSEYE"';

  it.each([
    {
      label: "the owner of the songs is accepted",
      found: tracksBy(["real"], ["real"], ["dupe"]),
      status: "auto",
      spotifyId: "real",
    },
    {
      label: "a tie stays in review",
      found: tracksBy(["real"], ["dupe"]),
      status: "needs_review",
      spotifyId: null,
    },
    { label: "no tracks stays in review", found: [], status: "needs_review", spotifyId: null },
  ] as const)("near-tie: $label, with one track search", async ({ found, status, spotifyId }) => {
    const { artists, deps, catalog } = setup(katseyes);
    deps.tracks = new FakeTrackCatalog({ [trackQuery]: found });
    const outcome = await resolveArtist(deps, artists.add("KATSEYE"));
    expect(outcome).toMatchObject({ status, spotifyId });
    expect((deps.tracks as FakeTrackCatalog).calls).toEqual([{ query: trackQuery, market: "IN" }]);
    expect(catalog.queries).toHaveLength(2);
  });

  it("stores the ownership breakdown for the review screen", async () => {
    const { artists, deps, candidateStore } = setup({
      ritviz: [
        spotifyArtist("a", "Ritviz", 0),
        spotifyArtist("b", "Ritviz", 1),
        spotifyArtist("c", "Ritviz", 2),
      ],
    });
    deps.tracks = new FakeTrackCatalog({ 'artist:"Ritviz"': tracksBy(["b"], ["b"]) });
    const artist = artists.add("Ritviz");
    const outcome = await resolveArtist(deps, artist);
    // b: 50 + 13.5 + 20 + 20 = 103.5 vs a: 85, a lead of 18.5.
    expect(outcome).toMatchObject({ status: "auto", spotifyId: "b", score: 103.5 });
    expect(outcome.decision?.best?.breakdown.songOwnership).toBe(20);
    expect(await candidateStore.get(artist.id)).toBeNull();
  });

  it.each([
    {
      label: "a clear winner",
      name: "Prateek Kuhad",
      results: { "prateek kuhad": [spotifyArtist("pk", "Prateek Kuhad", 0)] },
    },
    {
      label: "an imageless duplicate (D-039)",
      name: "Prateek Kuhad",
      results: {
        "prateek kuhad": [
          spotifyArtist("pk", "Prateek Kuhad", 0),
          spotifyArtist("x", "Prateek Kuhad", 1, { imageUrl: null }),
        ],
      },
    },
    { label: "no candidates", name: "When Chai Met Toast", results: {} },
    {
      label: "a short name forced to review",
      name: "KK",
      results: { kk: [spotifyArtist("a", "KK", 0), spotifyArtist("b", "KK", 1)] },
    },
    {
      label: "a near-tie the bonus can't lift to 70",
      name: "Anuv Jain",
      results: {
        "anuv jain": [
          spotifyArtist("a", "Anuv Jain Covers", 0, { imageUrl: null }),
          spotifyArtist("b", "Anuv Jain Fans", 1, { imageUrl: null }),
        ],
      },
    },
  ])("makes no track search for $label", async ({ name, results }) => {
    const { artists, deps, tracks } = setup(results);
    await resolveArtist(deps, artists.add(name));
    expect(tracks.calls).toEqual([]);
  });

  it("searches tracks at most once per artist in a batch", async () => {
    const { artists, deps, tracks } = setup({
      ...katseyes,
      ritviz: [spotifyArtist("r", "Ritviz", 0)],
    });
    artists.add("KATSEYE");
    artists.add("Ritviz");
    artists.add("KATSEYE (Live)");
    const report = await resolvePendingArtists(deps, 10);
    expect(report.resolved).toBe(3);
    expect(tracks.calls.map((c) => c.query)).toEqual([trackQuery, 'artist:"KATSEYE (Live)"']);
  });

  it("stops a batch cleanly when the track search is blocked", async () => {
    const resumeAfter = new Date("2026-11-21T15:00:00Z");
    const { artists, deps, tracks, catalog } = setup({
      ...katseyes,
      ritviz: [spotifyArtist("r", "Ritviz", 0)],
    });
    tracks.failOn(trackQuery, new SpotifyBlockedFake(resumeAfter));
    const first = artists.add("Ritviz");
    const blocked = artists.add("KATSEYE");
    const after = artists.add("Ritviz");
    const report = await resolvePendingArtists(deps, 10);
    expect(report).toMatchObject({ resolved: 1, blockedUntil: resumeAfter, failed: [] });
    expect((await artists.findById(first.id))?.matchStatus).toBe("auto");
    expect((await artists.findById(blocked.id))?.matchStatus).toBe("pending");
    expect((await artists.findById(after.id))?.matchStatus).toBe("pending");
    expect(catalog.queries.filter((q) => q === "ritviz")).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { createMatchingModule } from "@/application/matching";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { asArtistId } from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { DAY_MS, FakeArtistRepo, FakeCatalog, NOW, cand, fixedClock, sid } from "./fakes";

function setup(handler?: ConstructorParameters<typeof FakeCatalog>[0]) {
  const catalog = new FakeCatalog(handler);
  const artists = new FakeArtistRepo();
  const m = createMatchingModule({
    catalog,
    artists,
    clock: fixedClock(),
    tracks: {
      searchTracks: async () => [],
      getArtistAlbums: async () => [],
      getAlbumTracks: async () => [],
    },
  });
  return { catalog, artists, m };
}

const seedArtist = (repo: FakeArtistRepo, name: string, over = {}) =>
  repo.seed(name, normalizeArtistName(name), over);

describe("QA resolveArtist (LLD §6.3-6.6)", () => {
  // D-066: round two (variant searches) runs only when round one finds no name match, so a
  // round-one hit must stop at exactly these two searches.
  it('runs two app-token searches: artist:"<raw>" and the normalized name', async () => {
    const { catalog, artists, m } = setup(() => [cand("Beyoncé", 0)]);
    const a = seedArtist(artists, "Beyoncé");
    await m.resolveArtist(a);
    expect(catalog.calls).toHaveLength(2);
    const qs = catalog.calls.map((c) => c.query);
    expect(qs).toContain('artist:"Beyoncé"');
    expect(qs).toContain("beyonce");
    for (const c of catalog.calls) expect(c.caller).toEqual({ kind: "app" });
  });

  it("D-066: no match in round one → round two adds variant searches, still app-token, capped", async () => {
    const { catalog, artists, m } = setup(() => []);
    await m.resolveArtist(seedArtist(artists, "Beyoncé"));
    const qs = catalog.calls.map((c) => c.query);
    expect(qs.slice(0, 2)).toEqual(['artist:"Beyoncé"', "beyonce"]);
    expect(qs.length).toBeGreaterThan(2);
    expect(new Set(qs).size).toBe(qs.length);
    for (const c of catalog.calls) expect(c.caller).toEqual({ kind: "app" });
  });

  it("auto-accepts a clear exact match and records it with the injected clock", async () => {
    const top = cand("Daft Punk", 0);
    const { artists, m } = setup(() => [top, cand("Daft Punk Tribute", 1, { imageUrl: null })]);
    const a = seedArtist(artists, "Daft Punk");
    const out = await m.resolveArtist(a);
    expect(out.status).toBe("auto");
    expect(out.spotifyId).toBe(top.id);
    expect(out.source).toBe("search");
    const row = await artists.findById(a.id);
    expect(row?.matchStatus).toBe("auto");
    expect(row?.spotifyId).toBe(top.id);
    expect(row?.spotifyResolvedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("dedupes the same candidate returned by both searches (no self-tie)", async () => {
    const top = cand("Daft Punk", 0);
    const { m, artists } = setup(() => [top]);
    const out = await m.resolveArtist(seedArtist(artists, "Daft Punk"));
    expect(out.status).toBe("auto");
    expect(new Set(out.decision?.candidates.map((s) => s.candidate.id)).size).toBe(
      out.decision?.candidates.length,
    );
  });

  it("dedupe keeps the better (lower) rank for a candidate seen twice", async () => {
    const id = sid("dupdup");
    const { m, artists } = setup((_q, i) => [cand("Daft Punk", i === 0 ? 7 : 0, { id })]);
    const out = await m.resolveArtist(seedArtist(artists, "Daft Punk"));
    expect(out.decision?.candidates).toHaveLength(1);
    expect(out.decision?.best?.breakdown.rank).toBe(15);
  });

  it("no candidates -> not_found, spotifyId null", async () => {
    const { m, artists } = setup(() => []);
    const a = seedArtist(artists, "Nobody Knows Me");
    const out = await m.resolveArtist(a);
    expect(out.status).toBe("not_found");
    expect((await artists.findById(a.id))?.spotifyId).toBeNull();
  });

  it("needs_review keeps spotify_id null (D-015)", async () => {
    const { m, artists } = setup(() => [cand("Someone Else", 0)]);
    const a = seedArtist(artists, "Daft Punk");
    const out = await m.resolveArtist(a);
    expect(out.status).toBe("needs_review");
    const row = await artists.findById(a.id);
    expect(row?.matchStatus).toBe("needs_review");
    expect(row?.spotifyId).toBeNull();
  });

  // D-025: the second row is merged into the alias owner instead of copying its spotify_id.
  it("confirmed alias answers without calling Spotify (second row with same alias)", async () => {
    const { m, artists, catalog } = setup(() => [cand("X", 0)]);
    const target = seedArtist(artists, "Daft Punk", {
      matchStatus: "manual",
      spotifyId: sid("daftpunkid"),
      spotifyResolvedAt: NOW,
    });
    await artists.addAlias(target.id, normalizeArtistName("Daft Punk"));
    const fresh = seedArtist(artists, "Daft Punk (Live)");
    const out = await m.resolveArtist(fresh);
    expect(out.source).toBe("alias");
    expect(out.spotifyId).toBe(sid("daftpunkid"));
    expect(catalog.calls).toHaveLength(0);
    expect(out.duplicateOf).toBe(target.id);
    expect(await artists.findById(fresh.id)).toBeNull();
  });

  it("alias pointing to an unconfirmed artist is ignored (D-015)", async () => {
    const { m, artists, catalog } = setup(() => []);
    const target = seedArtist(artists, "Daft Punk", { matchStatus: "needs_review" });
    await artists.addAlias(target.id, normalizeArtistName("Daft Punk"));
    const fresh = seedArtist(artists, "DAFT PUNK");
    const out = await m.resolveArtist(fresh);
    expect(out.source).toBe("search");
    // Spotify was searched (2 round-one queries, plus D-066 variant queries when nothing matches).
    expect(catalog.calls.slice(0, 2).map((c) => c.query)).toEqual([
      'artist:"DAFT PUNK"',
      "daft punk",
    ]);
  });

  it("two artists sharing a top candidate in review both store null without conflict", async () => {
    const shared = cand("Anirudh", 0);
    const { m, artists } = setup(() => [shared, cand("Anirudh", 1)]);
    const a = seedArtist(artists, "Anirudh R");
    const b = seedArtist(artists, "Anirudh Ravi");
    await expect(m.resolveArtist(a)).resolves.toMatchObject({ status: "needs_review" });
    await expect(m.resolveArtist(b)).resolves.toMatchObject({ status: "needs_review" });
  });
});

describe("QA resolvePendingArtists (batch, D-006, D-009)", () => {
  it("asks for artists older than 30 days using the injected clock", async () => {
    const { m, artists } = setup(() => []);
    await m.resolvePendingArtists(10);
    expect(artists.needingResolutionArgs[0]?.olderThan.getTime()).toBe(NOW.getTime() - 30 * DAY_MS);
    expect(artists.needingResolutionArgs[0]?.limit).toBe(10);
  });

  it("stops cleanly on SpotifyBlockedError mid-batch", async () => {
    const resumeAfter = new Date(NOW.getTime() + 3600_000);
    let n = 0;
    const { m, artists, catalog } = setup(() => {
      n += 1;
      if (n === 3) return new SpotifyBlockedError("long_retry_after", resumeAfter);
      return [cand("Alpha Artist", 0)];
    });
    seedArtist(artists, "Alpha Artist");
    const b = seedArtist(artists, "Beta Artist");
    const c = seedArtist(artists, "Gamma Artist");
    const report = await m.resolvePendingArtists(10);
    expect(report.blockedUntil?.getTime()).toBe(resumeAfter.getTime());
    expect(report.resolved).toBe(1);
    expect(report.failed).toEqual([]);
    expect(catalog.calls.length).toBe(3);
    expect((await artists.findById(b.id))?.matchStatus).toBe("pending");
    expect((await artists.findById(c.id))?.matchStatus).toBe("pending");
  });

  it("treats any error carrying resumeAfter as a block (duck-typed)", async () => {
    const resumeAfter = new Date(NOW.getTime() + 60_000);
    const { m, artists } = setup(() =>
      Object.assign(new Error("gate paused"), { resumeAfter, reason: "gate_paused" }),
    );
    seedArtist(artists, "Alpha Artist");
    seedArtist(artists, "Beta Artist");
    const report = await m.resolvePendingArtists(10);
    expect(report.blockedUntil?.getTime()).toBe(resumeAfter.getTime());
    expect(report.resolved).toBe(0);
    expect(report.failed).toEqual([]);
  });

  it("a non-blocking error fails one artist and the batch goes on", async () => {
    const { m, artists } = setup((q) =>
      q.toLowerCase().includes("beta") ? new Error("boom 500") : [cand("Alpha Artist", 0)],
    );
    seedArtist(artists, "Alpha Artist");
    const b = seedArtist(artists, "Beta Artist");
    seedArtist(artists, "Gamma Artist");
    const report = await m.resolvePendingArtists(10);
    expect(report.failed.map((f) => f.artistId)).toEqual([b.id]);
    expect(report.resolved).toBe(2);
    expect(report.blockedUntil).toBeNull();
  });

  // D-025: the duplicate is merged into the row that holds the Spotify ID; the batch goes on.
  it("an auto match whose Spotify ID another artist holds is merged into it, not the batch", async () => {
    const top = cand("Daft Punk", 0);
    const { m, artists } = setup(() => [top]);
    const owner = seedArtist(artists, "Thomas Bangalter Project", {
      matchStatus: "manual",
      spotifyId: top.id,
      spotifyResolvedAt: NOW,
    });
    const dp = seedArtist(artists, "Daft Punk");
    const other = seedArtist(artists, "Other Artist");
    const report = await m.resolvePendingArtists(10);
    expect(report.failed).toEqual([]);
    const merged = report.outcomes.find((o) => o.artistId === dp.id);
    expect(merged?.duplicateOf).toBe(owner.id);
    expect(merged?.spotifyId).toBe(top.id);
    expect(await artists.findById(dp.id)).toBeNull();
    expect((await artists.findById(owner.id))?.spotifyId).toBe(top.id);
    expect(report.outcomes.map((o) => o.artistId)).toContain(other.id);
    expect(report.blockedUntil).toBeNull();
  });

  it("respects the limit and handles limit 0", async () => {
    const { m, artists } = setup(() => []);
    for (let i = 0; i < 5; i += 1) seedArtist(artists, `Artist Number ${i}`);
    expect((await m.resolvePendingArtists(2)).outcomes.length).toBeLessThanOrEqual(2);
    expect((await m.resolvePendingArtists(0)).outcomes.length).toBe(0);
  });
});

describe("QA review queue (LLD §6.6, §9)", () => {
  it("lists needs_review artists with candidates best first", async () => {
    const { m, artists } = setup(() => [cand("Daft Punk", 3), cand("Daft Punk", 0)]);
    const a = seedArtist(artists, "Daft Punk");
    await m.resolveArtist(a);
    const q = await m.listReviewQueue(10);
    expect(q.map((i) => i.artist.id)).toEqual([a.id]);
    const scores = q[0]!.candidates.map((s) => s.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    expect(q[0]!.candidatesSource).toBe("stored");
  });

  it("approve sets manual + spotify id + alias; next resolve uses the alias", async () => {
    const { m, artists, catalog } = setup(() => [cand("Daft Punk", 0), cand("Daft Punk", 1)]);
    const a = seedArtist(artists, "Daft Punk");
    await m.resolveArtist(a);
    const chosen = sid("chosenone");
    const r = await m.approveMatch(a.id, chosen);
    expect(r.ok).toBe(true);
    const row = await artists.findById(a.id);
    expect(row?.matchStatus).toBe("manual");
    expect(row?.spotifyId).toBe(chosen);
    expect(artists.aliases.get(normalizeArtistName("Daft Punk"))).toBe(a.id);
    expect(await m.listReviewQueue(10)).toEqual([]);
    catalog.calls = [];
    const out = await m.resolveArtist((await artists.findById(a.id))!);
    expect(out.source).toBe("alias");
    expect(out.spotifyId).toBe(chosen);
    expect(catalog.calls).toHaveLength(0);
  });

  it("same artist re-resolved via its own alias keeps manual status and its id", async () => {
    const { m, artists } = setup(() => [cand("Someone", 0)]);
    const a = seedArtist(artists, "Daft Punk");
    await m.approveMatch(a.id, sid("chosenone"));
    await m.resolveArtist((await artists.findById(a.id))!);
    const row = await artists.findById(a.id);
    expect(row?.spotifyId).toBe(sid("chosenone"));
    expect(["manual", "auto"]).toContain(row?.matchStatus);
  });

  it("approve/markNotFound on unknown artist -> artist_not_found", async () => {
    const { m } = setup();
    const ghost = asArtistId("11111111-1111-4111-8111-111111111111");
    expect(await m.approveMatch(ghost, sid("x"))).toEqual({ ok: false, error: "artist_not_found" });
    expect(await m.markNotFound(ghost)).toEqual({ ok: false, error: "artist_not_found" });
  });

  it("markNotFound sets not_found and clears the spotify id", async () => {
    const { m, artists } = setup(() => [cand("Someone", 0)]);
    const a = seedArtist(artists, "Daft Punk");
    await m.resolveArtist(a);
    expect((await m.markNotFound(a.id)).ok).toBe(true);
    const row = await artists.findById(a.id);
    expect(row?.matchStatus).toBe("not_found");
    expect(row?.spotifyId).toBeNull();
    expect(await m.listReviewQueue(10)).toEqual([]);
  });

  it("approve uses the injected clock for resolvedAt", async () => {
    const { m, artists } = setup(() => [cand("Someone", 0)]);
    const a = seedArtist(artists, "Daft Punk");
    await m.approveMatch(a.id, sid("abc"));
    expect((await artists.findById(a.id))?.spotifyResolvedAt?.getTime()).toBe(NOW.getTime());
  });
});

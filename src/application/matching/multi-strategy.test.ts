import { describe, expect, it } from "vitest";
import { AiUnavailableError, type WebPage } from "@/application/ports/web-search";
import { asArtistId, asEventId, asSpotifyArtistId } from "@/domain/shared/ids";
import { createInMemoryCandidateStore } from "./candidate-store";
import { createMatchingModule } from "./index";
import { resolveArtist, resolveEach, type ResolveDeps } from "./resolve-artist";
import { resolveEventLineup, type EventLineup } from "./resolve-event";
import {
  FakeArtistCatalog,
  FakeTrackCatalog,
  FakeWebSearch,
  InMemoryArtistRepository,
  SpotifyBlockedFake,
  album,
  fixedClock,
  spotifyArtist,
  tracksBy,
} from "./testing/fakes";
import { createInMemoryWebEvidenceCache } from "./web-evidence-cache";

// 22-character IDs, so web pages can cite them the way real ones do.
const A = "AAAAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBBBB";
const C = "CCCCCCCCCCCCCCCCCCCCCC";

const cite = (id: string, host: string, title: string): WebPage => ({
  url: `https://${host}/artist/${id}`,
  title,
  content: `${title}. Listen on Spotify.`,
});

function setup(
  results: ConstructorParameters<typeof FakeArtistCatalog>[0] = {},
  webResults: ConstructorParameters<typeof FakeWebSearch>[0] = {},
) {
  const artists = new InMemoryArtistRepository();
  const catalog = new FakeArtistCatalog(results);
  const tracks = new FakeTrackCatalog();
  const web = new FakeWebSearch(webResults);
  const candidateStore = createInMemoryCandidateStore();
  const deps: ResolveDeps = {
    artists,
    catalog,
    tracks,
    web,
    candidateStore,
    webCache: createInMemoryWebEvidenceCache(),
    clock: fixedClock(),
  };
  return { artists, catalog, tracks, web, candidateStore, deps };
}

describe("name variants (D-066 step 1)", () => {
  it("searches variants only when nothing matches the lineup name, within 4 searches", async () => {
    const { artists, catalog, deps } = setup();
    await resolveArtist(deps, artists.add("Dhyan Live"));
    expect(catalog.queries).toEqual([
      'artist:"Dhyan Live"',
      "dhyan live",
      'artist:"Dhyan"',
      'artist:"DJ Dhyan"',
    ]);
  });

  it("searches each side of a collaboration and never accepts one side", async () => {
    const { artists, catalog, web, deps } = setup({
      'artist:"PRFCT"': [spotifyArtist(A, "PRFCT", 0)],
      'artist:"DARK"': [spotifyArtist(B, "D.Ark", 4)],
    });
    const outcome = await resolveArtist(deps, artists.add("PRFCT & DARK"));
    expect(catalog.queries).toEqual([
      'artist:"PRFCT & DARK"',
      "prfct and dark",
      'artist:"PRFCT"',
      'artist:"DARK"',
    ]);
    expect(outcome).toMatchObject({ status: "needs_review", decision: { reason: "collab" } });
    expect(outcome.decision?.candidates.map((c) => c.breakdown.nameMatchKind)).toEqual([
      "collab_part",
      "collab_part",
    ]);
    expect(web.queries).toEqual([]);
  });
});

describe("strong evidence for a variant name (D-066 step 5)", () => {
  const dhyans = { 'artist:"Dhyan"': [spotifyArtist(A, "Dhyan", 0), spotifyArtist(B, "Dhyan", 1)] };

  it("accepts the variant that web pages cite for the artist", async () => {
    const { artists, web, deps } = setup(dhyans, {
      '"Dhyan" spotify artist': [
        cite(A, "kworb.net", "Dhyan - Spotify Top Songs"),
        cite(A, "musicmetricsvault.com", "Dhyan statistics"),
        cite(B, "open.spotify.com", "Dhyan | Spotify"),
      ],
    });
    const outcome = await resolveArtist(deps, artists.add("Dhyan Live"));
    expect(outcome).toMatchObject({ status: "auto", spotifyId: A });
    expect(outcome.decision?.best?.breakdown).toMatchObject({
      nameMatchKind: "variant",
      webLink: 30,
    });
    expect(outcome.decision?.best?.evidence?.webHosts).toEqual([
      "kworb.net",
      "musicmetricsvault.com",
    ]);
    expect(web.queries).toEqual(['"Dhyan" spotify artist']);
  });

  it("accepts a variant that owns at least two of its songs", async () => {
    const { artists, tracks, deps } = setup({ 'artist:"Avneet"': [spotifyArtist(A, "Avneet", 0)] });
    deps.tracks = new FakeTrackCatalog({ 'artist:"Avneet"': tracksBy([A], [A], ["other"]) });
    const outcome = await resolveArtist(deps, artists.add("Avneet Music"));
    expect(outcome).toMatchObject({ status: "auto", spotifyId: A });
    expect(tracks.calls).toEqual([]);
  });

  it("keeps a variant without evidence in review, with up to 3 candidates and their evidence", async () => {
    const { artists, candidateStore, deps } = setup({
      'artist:"Dhyan"': [
        spotifyArtist(A, "Dhyan", 0),
        spotifyArtist(B, "Dhyan", 1),
        spotifyArtist(C, "Dhyan", 2),
        spotifyArtist("DDDDDDDDDDDDDDDDDDDDDD", "Dhyan", 3),
      ],
    });
    (deps.tracks as FakeTrackCatalog).albums[A] = [album("2025")];
    const artist = artists.add("Dhyan Live");
    const outcome = await resolveArtist(deps, artist);
    expect(outcome).toMatchObject({ status: "needs_review", spotifyId: null });
    const stored = await candidateStore.get(artist.id);
    expect(stored).toHaveLength(3);
    expect(stored?.[0]).toMatchObject({
      candidate: { id: A },
      breakdown: { active: 10 },
      evidence: { matchedName: "Dhyan", newestReleaseYear: 2025, ownedTracks: 0, webHosts: [] },
    });
    expect((deps.tracks as FakeTrackCatalog).albumCalls).toEqual([A, B, C]);
  });

  it("accepts a variant that MusicBrainz relations link", async () => {
    const { artists, deps } = setup({ 'artist:"Dhyan"': [spotifyArtist(A, "Dhyan", 0)] });
    deps.relations = { linkedSpotifyIds: async () => [asSpotifyArtistId(A)] };
    const outcome = await resolveArtist(deps, artists.add("Dhyan Live"));
    expect(outcome).toMatchObject({ status: "auto", spotifyId: A });
    expect(outcome.decision?.best?.breakdown.externalId).toBe(20);
  });
});

describe("same-name duplicates and common names", () => {
  it("lets web citations pick among same-name profiles when songs don't (MXRCI)", async () => {
    const { artists, deps } = setup(
      {
        mxrci: [
          spotifyArtist(B, "Mxrci", 0),
          spotifyArtist(C, "mxrci", 1),
          spotifyArtist(A, "Mxrci", 2),
        ],
      },
      {
        '"MXRCI (Live Set)" spotify artist': [
          cite(A, "discography.in", "Mxrci: Songs, Karan Aujla Hits"),
          cite(A, "kworb.net", "Mxrci - Spotify Top Songs"),
          cite(B, "open.spotify.com", "Mxrci | Spotify"),
        ],
      },
    );
    const outcome = await resolveArtist(deps, artists.add("MXRCI (Live Set)"));
    expect(outcome).toMatchObject({ status: "auto", spotifyId: A });
  });

  it.each([
    ["no web evidence", {}, "needs_review", null],
    [
      "two sites citing it",
      { '"Felix" spotify artist': [cite(A, "a.com", "Felix DJ"), cite(A, "b.in", "Felix")] },
      "auto",
      A,
    ],
    [
      "one site citing it",
      { '"Felix" spotify artist': [cite(A, "a.com", "Felix DJ")] },
      "needs_review",
      null,
    ],
  ] as const)("a common name with %s → %s", async (_label, webResults, status, spotifyId) => {
    const { artists, tracks, deps } = setup(
      { felix: [spotifyArtist(A, "Felix", 0), spotifyArtist(B, "felix jaehn", 1)] },
      webResults,
    );
    const outcome = await resolveArtist(deps, artists.add("Felix"));
    expect(outcome).toMatchObject({ status, spotifyId });
    // Song ownership can't tell one Felix from another, so it isn't asked.
    expect(tracks.calls).toEqual([]);
  });

  it("adds the event's city and title to the second web query", async () => {
    const { artists, web, deps } = setup({ felix: [spotifyArtist(A, "Felix", 0)] });
    await resolveArtist(deps, artists.add("Felix"), {
      event: { title: "HOME Festival 2026", city: "Goa" },
    });
    expect(web.queries).toEqual([
      '"Felix" spotify artist',
      '"Felix" DJ OR artist spotify Goa HOME Festival 2026',
    ]);
  });
});

describe("web search limits", () => {
  const felix = { felix: [spotifyArtist(A, "Felix", 0)] };

  it("shares one web budget across a run and notes what it skipped", async () => {
    const { artists, web, deps } = setup(felix);
    deps.webSearchesPerRun = 1;
    const work = [artists.add("Felix"), artists.add("Felix")].map((artist) => ({
      artist,
      context: {},
    }));
    const report = await resolveEach(deps, work);
    expect(web.queries).toHaveLength(1);
    expect(report.outcomes[1]?.notes.join()).toContain("budget spent");
  });

  it("uses cached web results for 30 days", async () => {
    const { artists, web, deps } = setup(felix);
    await resolveArtist(deps, artists.add("Felix"));
    await resolveArtist(deps, artists.add("Felix"));
    expect(web.queries).toHaveLength(2);
  });

  it("stops searching the web for the run when the service is rate limited", async () => {
    const { artists, web, deps } = setup(felix);
    web.failWith(new AiUnavailableError("tavily", "limit"));
    const work = [artists.add("Felix"), artists.add("Felix")].map((artist) => ({
      artist,
      context: {},
    }));
    const report = await resolveEach(deps, work);
    expect(web.queries).toHaveLength(1);
    expect(report.outcomes.map((o) => o.status)).toEqual(["needs_review", "needs_review"]);
    expect(report.outcomes[0]?.notes.join()).toContain("web search failed");
  });

  it("stops the batch cleanly when an album lookup is blocked", async () => {
    const resumeAfter = new Date("2026-11-21T15:00:00Z");
    const { artists, deps } = setup({
      'artist:"Dhyan"': [spotifyArtist(A, "Dhyan", 0), spotifyArtist(B, "Dhyan", 1)],
    });
    (deps.tracks as FakeTrackCatalog).failOn(`albums:${A}`, new SpotifyBlockedFake(resumeAfter));
    const work = [artists.add("Dhyan Live"), artists.add("Ritviz")].map((artist) => ({
      artist,
      context: {},
    }));
    const report = await resolveEach(deps, work);
    expect(report).toMatchObject({ resolved: 0, blockedUntil: resumeAfter, failed: [] });
  });
});

describe("resolveEventLineup", () => {
  const lineup = (artists: EventLineup["artists"]): EventLineup => ({
    title: "HOME Festival 2026",
    city: "Goa",
    genre: null,
    artists,
  });

  it("retries only unconfirmed artists, with the event as context", async () => {
    const { artists, web, deps } = setup({ felix: [spotifyArtist(A, "Felix", 0)] });
    const felix = artists.add("Felix", { matchStatus: "needs_review" });
    const done = artists.add("Ritviz", { matchStatus: "auto" });
    const eventLineups = {
      getEventLineup: async () =>
        lineup([
          { artistId: felix.id, matchStatus: "needs_review" },
          { artistId: done.id, matchStatus: "auto" },
        ]),
    };
    const result = await resolveEventLineup({ ...deps, eventLineups }, asEventId("e1"));
    expect(result.ok && result.value.outcomes.map((o) => o.artistId)).toEqual([felix.id]);
    expect(web.queries.at(-1)).toContain("Goa HOME Festival 2026");
  });

  it("returns event_not_found for an unknown event", async () => {
    const { deps } = setup();
    const eventLineups = { getEventLineup: async () => null };
    expect(await resolveEventLineup({ ...deps, eventLineups }, asEventId("x"))).toEqual({
      ok: false,
      error: "event_not_found",
    });
  });

  it("skips lineup entries whose artist row is gone", async () => {
    const { deps } = setup();
    const eventLineups = {
      getEventLineup: async () =>
        lineup([{ artistId: asArtistId("gone"), matchStatus: "pending" }]),
    };
    const result = await resolveEventLineup({ ...deps, eventLineups }, asEventId("e1"));
    expect(result.ok && result.value.resolved).toBe(0);
  });

  it("is exposed by the module once the reader is wired", async () => {
    const base = {
      artists: new InMemoryArtistRepository(),
      catalog: new FakeArtistCatalog(),
      tracks: new FakeTrackCatalog(),
      clock: fixedClock(),
    };
    await expect(createMatchingModule(base).resolveEventLineup(asEventId("e1"))).rejects.toThrow(
      "eventLineups",
    );
    const wired = createMatchingModule({
      ...base,
      eventLineups: { getEventLineup: async () => null },
    });
    expect(await wired.resolveEventLineup(asEventId("e1"))).toEqual({
      ok: false,
      error: "event_not_found",
    });
  });
});

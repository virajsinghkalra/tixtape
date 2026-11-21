/**
 * QA P2.2: popularity signals (D-038, D-043) — Last.fm, Apple RSS, Spotify newest releases,
 * and the per-artist picker that combines them. Third parties are faked with msw.
 */
import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chartTitlesFor, pickArtistTracks } from "@/application/playlists/pick-artist-tracks";
import type { MostListenedSource } from "@/application/ports/music-signals";
import {
  SpotifyBlockedError,
  type SpotifyAlbum,
  type SpotifyTrack,
  type TrackCatalog,
} from "@/application/ports/spotify";
import { AppleMusicTrending } from "@/infrastructure/music-signals/apple-chart";
import { LastfmMostListened } from "@/infrastructure/music-signals/lastfm";
import { SpotifyNewReleases } from "@/infrastructure/music-signals/spotify-new-releases";
import { UpstreamError } from "@/lib/errors";
import { asSpotifyArtistId, asSpotifyTrackId } from "@/domain/shared/ids";
import { FakeCatalog, FakeNewReleases, ManualClock, artistSid, trackSid } from "./fakes";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LFM = "https://lastfm.qa/2.0/";
const API_KEY = "qa-lastfm-key-SECRET-123";
const lfmTrack = (name: string, playcount: number) => ({
  name,
  playcount: String(playcount),
  listeners: String(Math.floor(playcount / 3)),
  mbid: "",
  url: "https://www.last.fm/x",
  artist: { name: "Prateek Kuhad", mbid: "", url: "https://www.last.fm/x" },
  "@attr": { rank: "1" },
});
const lfmBody = (tracks: unknown) => ({
  toptracks: {
    track: tracks,
    "@attr": { artist: "Prateek Kuhad", page: "1", perPage: "50", totalPages: "1", total: "3" },
  },
});

function lastfm(clock = new ManualClock()) {
  const sleep = vi.fn(async (ms: number) => void clock.advance(ms));
  const fetchSpy = vi.fn((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    src: new LastfmMostListened({
      apiKey: API_KEY,
      fetch: fetchSpy as typeof fetch,
      sleep,
      clock,
      baseUrl: LFM,
    }),
    sleep,
    fetchSpy,
    clock,
  };
}

describe("QA Last.fm most-listened", () => {
  it("parses getTopTracks, numbers from strings, most played first", async () => {
    server.use(
      mock.get(`${LFM}*`, () =>
        HttpResponse.json(lfmBody([lfmTrack("Kasoor", 5000), lfmTrack("cold/mess", 900)])),
      ),
    );
    const { src } = lastfm();
    const out = await src.topTracks("Prateek Kuhad");
    expect(out.map((t) => t.title)).toEqual(["Kasoor", "cold/mess"]);
    expect(out[0]).toMatchObject({ playcount: 5000 });
    expect(typeof out[0]!.listeners).toBe("number");
  });

  it("sends the artist name and method, and uses mbid when given", async () => {
    let url: URL | null = null;
    server.use(
      mock.get(
        `${LFM}*`,
        ({ request }) => ((url = new URL(request.url)), HttpResponse.json(lfmBody([]))),
      ),
    );
    const { src } = lastfm();
    await src.topTracks("Seedhe Maut & Friends", "mbid-123");
    expect(url!.searchParams.get("method")?.toLowerCase()).toBe("artist.gettoptracks");
    expect(url!.searchParams.get("format")).toBe("json");
    expect(url!.searchParams.get("mbid") ?? url!.searchParams.get("artist")).toBeTruthy();
  });

  it("unknown artist (error 6) is an empty list, not an error", async () => {
    server.use(
      mock.get(`${LFM}*`, () =>
        HttpResponse.json(
          { error: 6, message: "The artist you supplied could not be found" },
          { status: 200 },
        ),
      ),
    );
    expect(await lastfm().src.topTracks("Nobody At All")).toEqual([]);
  });

  it("accepts a single track object (Last.fm collapses 1-item arrays)", async () => {
    server.use(mock.get(`${LFM}*`, () => HttpResponse.json(lfmBody(lfmTrack("Only One", 10)))));
    const r = await lastfm()
      .src.topTracks("Solo")
      .then(
        (x) => x,
        (e: unknown) => e,
      );
    // Either 1 track or a clean UpstreamError (no signal) is acceptable; a raw ZodError/TypeError is not.
    if (Array.isArray(r)) expect(r.map((t) => t.title)).toEqual(["Only One"]);
    else expect(r).toBeInstanceOf(UpstreamError);
  });

  it.each([
    [
      "error 29 in body",
      () => HttpResponse.json({ error: 29, message: "Rate limit exceeded" }, { status: 200 }),
    ],
    [
      "error 29 with HTTP 429",
      () => HttpResponse.json({ error: 29, message: "Rate limit exceeded" }, { status: 429 }),
    ],
    [
      "malformed JSON",
      () =>
        new HttpResponse("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ],
    [
      "HTML error page",
      () =>
        new HttpResponse("<html>502</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    ],
    [
      "schema mismatch",
      () => HttpResponse.json({ toptracks: { track: [{ name: 42, playcount: "abc" }] } }),
    ],
    [
      "invalid key (error 10)",
      () => HttpResponse.json({ error: 10, message: "Invalid API key" }, { status: 403 }),
    ],
  ])(
    "%s → UpstreamError (or empty), never a raw error, bounded waiting, key not leaked",
    async (_l, handler) => {
      server.use(mock.get(`${LFM}*`, handler));
      const { src, sleep } = lastfm();
      const r = await src.topTracks("Ritviz").then(
        (x) => x,
        (e: unknown) => e,
      );
      if (!Array.isArray(r)) {
        expect(r).toBeInstanceOf(UpstreamError);
        expect(String((r as Error).message)).not.toContain(API_KEY);
        expect(JSON.stringify(r)).not.toContain(API_KEY);
      } else expect(r).toEqual([]);
      const waited = sleep.mock.calls.reduce((s, [ms]) => s + ms, 0);
      expect(waited).toBeLessThanOrEqual(8_000);
    },
  );

  it("network failure → UpstreamError without the api key in the message", async () => {
    server.use(mock.get(`${LFM}*`, () => HttpResponse.error()));
    const e = await lastfm()
      .src.topTracks("Ritviz")
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UpstreamError);
    expect(String((e as Error).message) + String((e as Error).stack)).not.toContain(API_KEY);
  });

  it("caches per artist for 24 h", async () => {
    let calls = 0;
    server.use(
      mock.get(`${LFM}*`, () => (calls++, HttpResponse.json(lfmBody([lfmTrack("A", 1)])))),
    );
    const { src, clock } = lastfm();
    await src.topTracks("Nucleya");
    await src.topTracks("Nucleya");
    expect(calls).toBe(1);
    clock.advance(23 * 3600_000);
    await src.topTracks("Nucleya");
    expect(calls).toBe(1);
    clock.advance(2 * 3600_000);
    await src.topTracks("Nucleya");
    expect(calls).toBe(2);
  });

  it("a slow (hung) Last.fm response does not hang the caller forever", async () => {
    vi.useFakeTimers();
    try {
      const clock = new ManualClock();
      const hung = vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise<Response>((_res, rej) =>
            init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
          ),
      );
      const src = new LastfmMostListened({
        apiKey: API_KEY,
        fetch: hung as never,
        sleep: async () => {},
        clock,
        baseUrl: LFM,
      });
      let settled = false;
      const p = src.topTracks("Hanging Artist").then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(hung).toHaveBeenCalledTimes(1);
      const passedSignal = hung.mock.calls[0]?.[1]?.signal !== undefined;
      // BUG (QA-P-2): no timeout / AbortSignal on Last.fm fetches: one slow response blocks the
      // ~8 s step budget (D-005) indefinitely.
      expect(settled || passedSignal).toBe(true);
      void p;
    } finally {
      vi.useRealTimers();
    }
  });
});

const APPLE = "https://apple.qa";
const appleBody = (results: { artistName: string; name: string }[]) => ({
  feed: {
    title: "Top Songs",
    country: "in",
    results: results.map((r, i) => ({
      ...r,
      id: String(1000 + i),
      kind: "songs",
      url: "https://music.apple.com/x",
    })),
  },
});

describe("QA Apple Music most-played chart", () => {
  it("parses entries with ranks in chart order, India market in the URL", async () => {
    let path = "";
    server.use(
      mock.get(
        `${APPLE}/*`,
        ({ request }) => (
          (path = new URL(request.url).pathname),
          HttpResponse.json(
            appleBody([
              { artistName: "Arijit Singh", name: "Tum Hi Ho" },
              { artistName: "AP Dhillon", name: "Brown Munde" },
            ]),
          )
        ),
      ),
    );
    const src = new AppleMusicTrending({
      fetch: (...a) => fetch(...a),
      clock: new ManualClock(),
      baseUrl: APPLE,
    });
    const out = await src.chart("IN");
    expect(path.toLowerCase()).toContain("/in/music/most-played/");
    expect(out.map((e) => [e.title, e.artistName])).toEqual([
      ["Tum Hi Ho", "Arijit Singh"],
      ["Brown Munde", "AP Dhillon"],
    ]);
    expect(out[0]!.rank).toBeLessThan(out[1]!.rank);
  });

  it("empty chart → []", async () => {
    server.use(mock.get(`${APPLE}/*`, () => HttpResponse.json(appleBody([]))));
    expect(
      await new AppleMusicTrending({
        fetch: (...a) => fetch(...a),
        clock: new ManualClock(),
        baseUrl: APPLE,
      }).chart("IN"),
    ).toEqual([]);
  });

  it.each([
    ["malformed", () => new HttpResponse("{{", { status: 200 })],
    ["wrong shape", () => HttpResponse.json({ feed: { results: "nope" } })],
    ["500", () => new HttpResponse("oops", { status: 500 })],
  ])("%s → UpstreamError", async (_l, h) => {
    server.use(mock.get(`${APPLE}/*`, h));
    const e = await new AppleMusicTrending({
      fetch: (...a) => fetch(...a),
      clock: new ManualClock(),
      baseUrl: APPLE,
    })
      .chart("IN")
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(UpstreamError);
  });

  it("fetches once a day for all artists", async () => {
    let calls = 0;
    server.use(
      mock.get(
        `${APPLE}/*`,
        () => (calls++, HttpResponse.json(appleBody([{ artistName: "A", name: "S" }]))),
      ),
    );
    const clock = new ManualClock();
    const src = new AppleMusicTrending({ fetch: (...a) => fetch(...a), clock, baseUrl: APPLE });
    await Promise.all([src.chart("IN"), src.chart("IN"), src.chart("IN")]);
    await src.chart("IN");
    expect(calls).toBeLessThanOrEqual(1 + 2); // concurrent first calls may race; sequential reuse must not
    const before = calls;
    clock.advance(25 * 3600_000);
    await src.chart("IN");
    expect(calls).toBe(before + 1);
  });
});

describe("QA chartTitlesFor (D-043: matched by normalized name)", () => {
  const chart = [
    { title: "Pal Pal", artistName: "Afusic & AliSoomroMusic", rank: 1 },
    { title: "Kesariya", artistName: "Pritam, Arijit Singh & Amitabh Bhattacharya", rank: 2 },
    { title: "Husn", artistName: "Anuv Jain", rank: 3 },
    { title: "Winning Speech", artistName: "Karan Aujla", rank: 4 },
    { title: "Tauba Tauba", artistName: "Karan Aujla", rank: 5 },
    { title: "Hustle", artistName: "Raja Kumari", rank: 6 },
    { title: "Sajni", artistName: "ARIJIT SINGH", rank: 7 },
    { title: "Ghana Kasoota", artistName: "Rashmeet Kaur feat. Raftaar", rank: 8 },
  ];
  it("finds split credits and case-insensitive names, best rank first", () => {
    // BUG (QA-P-1): comma-separated credits ("Pritam, Arijit Singh & …") are not split, so
    // Arijit Singh misses "Kesariya". Apple's India chart uses this format for most film songs.
    expect(chartTitlesFor("Arijit Singh", chart)).toEqual(["Kesariya", "Sajni"]);
    expect(chartTitlesFor("Karan Aujla", chart)).toEqual(["Winning Speech", "Tauba Tauba"]);
    expect(chartTitlesFor("afusic", chart)).toEqual(["Pal Pal"]);
  });
  it("does not match a partial name (Raja ≠ Raja Kumari)", () => {
    expect(chartTitlesFor("Raja", chart)).toEqual([]);
    expect(chartTitlesFor("Anuv", chart)).toEqual([]);
  });
  it("artist absent from the chart → []", () => {
    expect(chartTitlesFor("Prateek Kuhad", chart)).toEqual([]);
    expect(chartTitlesFor("Prateek Kuhad", [])).toEqual([]);
  });
  it("finds a featured credit", () => {
    expect(chartTitlesFor("Raftaar", chart)).toEqual(["Ghana Kasoota"]);
  });
});

describe("QA SpotifyNewReleases", () => {
  const ART = artistSid("NR1");
  const tr = (id: string, albumId: string, date: string): SpotifyTrack => ({
    id: trackSid(id),
    name: id,
    artistIds: [ART],
    albumId,
    albumReleaseDate: date,
    isrc: null,
    durationMs: 1,
    rank: 0,
  });
  const albums: SpotifyAlbum[] = [
    { id: "old", name: "Old", releaseDate: "2019-01-01", albumType: "album" },
    { id: "comp", name: "Comp", releaseDate: "2026-11-01", albumType: "compilation" },
    { id: "new", name: "New", releaseDate: "2026-10-01", albumType: "single" },
    { id: "feat", name: "Appears", releaseDate: "2026-11-10", albumType: "appears_on" },
    { id: "mid", name: "Mid", releaseDate: "2023", albumType: "album" },
  ];
  const catalog = (): TrackCatalog & { albumsCalls: number } => ({
    albumsCalls: 0,
    searchTracks: async () => [],
    async getArtistAlbums() {
      this.albumsCalls += 1;
      return albums;
    },
    getAlbumTracks: async (id: string) => [tr(`${id}1`, id, "x"), tr(`${id}2`, id, "x")],
  });

  it("newest album/single first, skips compilations and appears_on, respects limit", async () => {
    const src = new SpotifyNewReleases(catalog(), new ManualClock());
    const out = await src.newestTracks(ART, "IN", 3);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out[0]!.id).toBe(trackSid("new1"));
    expect(out.map((t) => t.id)).not.toContain(trackSid("comp1"));
    expect(out.map((t) => t.id)).not.toContain(trackSid("feat1"));
  });

  it("QUOTA_EXCEEDED from Spotify propagates (so the runner can pause)", async () => {
    const blocked = new SpotifyBlockedError("quota_exceeded", new Date("2026-11-21T11:00:00Z"));
    const c = { ...catalog(), getArtistAlbums: async () => Promise.reject(blocked) };
    await expect(
      new SpotifyNewReleases(c, new ManualClock()).newestTracks(ART, "IN", 2),
    ).rejects.toBe(blocked);
  });
});

describe("QA pickArtistTracks", () => {
  const ART = artistSid("PK1");
  const setup = (ml: MostListenedSource) => {
    const tracks = new FakeCatalog();
    tracks.addArtist("Prateek Kuhad", ART, [
      { name: "Kasoor" },
      { name: "cold/mess" },
      { name: "Tum Jab Paas" },
      { name: "Co2" },
      { name: "Raat Raazi" },
      { name: "Shehar" },
      { name: "With You/For You" },
      { name: "Just Like That" },
      { name: "Full Time Lover" },
      { name: "Kadam" },
      { name: "Kasoor (Live)" },
    ]);
    const warn = vi.fn();
    const deps = { tracks, mostListened: ml, newReleases: new FakeNewReleases(), logger: { warn } };
    const input = {
      artist: { name: "Prateek Kuhad", spotifyId: ART, tier: "headliner" as const },
      market: "IN",
      chart: [],
      alreadyPicked: [],
    };
    return { deps, input, warn, tracks };
  };

  it("Last.fm failure → rollover to other signals, warning logged, no crash", async () => {
    const { deps, input, warn } = setup({
      topTracks: async () => Promise.reject(new UpstreamError("lastfm", "boom")),
    });
    const out = await pickArtistTracks(deps, input);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(warn).toHaveBeenCalled();
  });

  it("Last.fm titles are mapped to Spotify tracks credited to the artist", async () => {
    const { deps, input } = setup({
      topTracks: async () => [
        { title: "cold/mess", playcount: 9, listeners: 1 },
        { title: "Kasoor", playcount: 8, listeners: 1 },
      ],
    });
    const names = (await pickArtistTracks(deps, input)).map((t) => t.name);
    expect(names).toContain("cold/mess");
    expect(names).toContain("Kasoor");
    expect(names).not.toContain("Kasoor (Live)");
  });

  it("a Spotify result not crediting the resolved artist id is not kept", async () => {
    const { deps, input, tracks } = setup({
      topTracks: async () => [{ title: "Imposter", playcount: 9, listeners: 1 }],
    });
    tracks.byArtist.get(ART)!.push({
      id: asSpotifyTrackId("TR0000000000000IMPOSTR"),
      name: "Imposter",
      artistIds: [asSpotifyArtistId("AR00000000000000OTHER1")],
      albumId: "a",
      albumReleaseDate: null,
      isrc: null,
      durationMs: 1,
      rank: 0,
    });
    expect((await pickArtistTracks(deps, input)).map((t) => t.name)).not.toContain("Imposter");
  });

  it("SpotifyBlockedError (QUOTA_EXCEEDED) mid-pick is rethrown, not swallowed as 'no signal'", async () => {
    const { deps, input, tracks } = setup({
      topTracks: async () => [{ title: "Kasoor", playcount: 9, listeners: 1 }],
    });
    const blocked = new SpotifyBlockedError("quota_exceeded", new Date("2026-11-21T11:00:00Z"));
    tracks.onSearch = () => {
      throw blocked;
    };
    await expect(pickArtistTracks(deps, input)).rejects.toBeInstanceOf(SpotifyBlockedError);
  });

  it("artist with no tracks anywhere → [] without throwing", async () => {
    const tracks = new FakeCatalog();
    const deps = {
      tracks,
      mostListened: { topTracks: async () => [] },
      newReleases: new FakeNewReleases(),
      logger: { warn: vi.fn() },
    };
    const out = await pickArtistTracks(deps, {
      artist: { name: "Ghost", spotifyId: artistSid("GH1"), tier: "support" },
      market: "IN",
      chart: [],
      alreadyPicked: [],
    });
    expect(out).toEqual([]);
  });

  it("artist names with quotes don't break the search query", async () => {
    const tracks = new FakeCatalog();
    const id = artistSid("QT1");
    tracks.addArtist('DJ "Snake" Jr', id, [{ name: "Hit" }]);
    const deps = {
      tracks,
      mostListened: { topTracks: async () => [] },
      newReleases: new FakeNewReleases(),
      logger: { warn: vi.fn() },
    };
    await pickArtistTracks(deps, {
      artist: { name: 'DJ "Snake" Jr', spotifyId: id, tier: "support" },
      market: "IN",
      chart: [],
      alreadyPicked: [],
    });
    for (const q of tracks.searches) expect((q.match(/"/g) ?? []).length % 2).toBe(0);
  });
});

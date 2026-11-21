import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SpotifyAlbum, SpotifyTrack, TrackCatalog } from "@/application/ports/spotify";
import { asSpotifyArtistId, asSpotifyTrackId } from "@/domain/shared/ids";
import { UpstreamError } from "@/lib/errors";
import { AppleMusicTrending } from "./apple-chart";
import applePage from "./fixtures/apple-most-played-in.json";
import lastfmPage from "./fixtures/lastfm-toptracks.json";
import {
  LASTFM_ATTRIBUTION,
  LASTFM_BASE_URL,
  LastfmClient,
  LastfmMostListened,
  LastfmPopularity,
} from "./lastfm";
import { SpotifyNewReleases } from "./spotify-new-releases";
import { DAY_MS } from "./ttl-cache";

const APPLE_URL = "https://rss.marketingtools.apple.com/api/v2/in/music/most-played/100/songs.json";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fakeTime(start = Date.parse("2026-11-21T10:00:00Z")) {
  let now = start;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  return { clock: { now: () => new Date(now) }, sleep, advance: (ms: number) => (now += ms) };
}

function lastfm() {
  const time = fakeTime();
  const adapter = new LastfmMostListened({
    apiKey: "k",
    fetch: (...a) => fetch(...a),
    sleep: time.sleep,
    clock: time.clock,
  });
  return { adapter, time };
}

describe("LastfmMostListened", () => {
  it("sends the documented query and parses string counts", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(lastfmPage);
      }),
    );
    const { adapter } = lastfm();
    await expect(adapter.topTracks("Ritviz", "mbid-1")).resolves.toEqual([
      { title: "Udd Gaye", playcount: 1523401, listeners: 201345 },
      { title: "Liggi", playcount: 987001, listeners: 150002 },
    ]);
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({
      method: "artist.gettoptracks",
      artist: "Ritviz",
      mbid: "mbid-1",
      autocorrect: "1",
      limit: "50",
      api_key: "k",
      format: "json",
    });
    expect(LASTFM_ATTRIBUTION).toContain("Last.fm");
  });

  it("caches per artist for 24 hours", async () => {
    let calls = 0;
    server.use(
      http.get(LASTFM_BASE_URL, () => {
        calls++;
        return HttpResponse.json(lastfmPage);
      }),
    );
    const { adapter, time } = lastfm();
    await adapter.topTracks("Ritviz");
    await adapter.topTracks("RITVIZ");
    expect(calls).toBe(1);
    time.advance(DAY_MS);
    await adapter.topTracks("Ritviz");
    expect(calls).toBe(2);
  });

  it("paces requests at most 5 per second", async () => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json(lastfmPage)));
    const { adapter, time } = lastfm();
    await Promise.all(["a", "b", "c"].map((n) => adapter.topTracks(n)));
    // Requests go out at t=0, 200 and 400 ms (the fake sleep moves the shared clock).
    expect(time.sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 200]);
  });

  it.each([
    [
      "a single track object",
      { toptracks: { track: { name: "Only", playcount: 5, listeners: "2" } } },
      1,
    ],
    ["no tracks", { toptracks: { "@attr": {} } }, 0],
    [
      "unknown artist (error 6)",
      { error: 6, message: "The artist you supplied could not be found" },
      0,
    ],
  ])("handles %s", async (_n, body, length) => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json(body)));
    await expect(lastfm().adapter.topTracks("x")).resolves.toHaveLength(length);
  });

  it.each([
    ["an API error", () => HttpResponse.json({ error: 29, message: "Rate limit" })],
    ["a 500", () => new HttpResponse("oops", { status: 500 })],
    ["a malformed body", () => HttpResponse.json({ toptracks: { track: [{ name: 1 }] } })],
    ["a network error", () => HttpResponse.error()],
  ])("throws UpstreamError on %s and doesn't cache it", async (_n, reply) => {
    server.use(http.get(LASTFM_BASE_URL, reply));
    const { adapter } = lastfm();
    await expect(adapter.topTracks("x")).rejects.toBeInstanceOf(UpstreamError);
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json(lastfmPage)));
    await expect(adapter.topTracks("x")).resolves.toHaveLength(2);
  });
});

describe("LastfmPopularity (artist.getInfo, D-065)", () => {
  const info = (listeners: string) => ({
    artist: { name: "Ritviz", stats: { listeners, playcount: "999" } },
  });
  const popularity = () => {
    const time = fakeTime();
    const deps = {
      apiKey: "k",
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
      sleep: time.sleep,
      clock: time.clock,
    };
    return { source: new LastfmPopularity(deps), time };
  };

  it("returns listeners and caches them for 7 days", async () => {
    let calls = 0;
    const seen: URL[] = [];
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        calls++;
        seen.push(new URL(request.url));
        return HttpResponse.json(info("312345"));
      }),
    );
    const { source, time } = popularity();
    await expect(source.listeners("Ritviz")).resolves.toBe(312345);
    expect(seen[0]!.searchParams.get("method")).toBe("artist.getinfo");
    time.advance(6 * DAY_MS);
    await source.listeners("ritviz");
    expect(calls).toBe(1);
    time.advance(DAY_MS);
    await source.listeners("Ritviz");
    expect(calls).toBe(2);
  });

  it("answers cachedOnly lookups without a request", async () => {
    let calls = 0;
    server.use(http.get(LASTFM_BASE_URL, () => (calls++, HttpResponse.json(info("10")))));
    const { source } = popularity();
    await expect(source.listeners("Ritviz", { cachedOnly: true })).resolves.toBeNull();
    expect(calls).toBe(0);
    await source.listeners("Ritviz");
    await expect(source.listeners("Ritviz", { cachedOnly: true })).resolves.toBe(10);
  });

  it("is null for an unknown artist and throws UpstreamError on bad data", async () => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json({ error: 6, message: "nope" })));
    await expect(popularity().source.listeners("Nobody")).resolves.toBeNull();
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json({ artist: {} })));
    await expect(popularity().source.listeners("Odd")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("shares pacing with top tracks through one client", async () => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json(info("1"))));
    const time = fakeTime();
    const deps = {
      apiKey: "k",
      fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
      sleep: time.sleep,
      clock: time.clock,
    };
    const client = new LastfmClient(deps);
    const pop = new LastfmPopularity(deps, client);
    const top = new LastfmMostListened(deps, client);
    await Promise.all([pop.listeners("a"), top.topTracks("b").catch(() => []), pop.listeners("c")]);
    expect(time.sleep).toHaveBeenCalledTimes(2);
  });
});

describe("request timeouts (D-045)", () => {
  /** Never answers; rejects only when its signal aborts. */
  const hung = vi.fn(
    (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(init.signal?.reason)),
      ),
  );

  it("Last.fm gives up on a hung response with UpstreamError (no signal, not a crash)", async () => {
    const time = fakeTime();
    const src = new LastfmMostListened({
      apiKey: "k",
      fetch: hung as never,
      sleep: time.sleep,
      clock: time.clock,
      timeoutMs: 20,
    });
    await expect(src.topTracks("Hanging")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("Apple gives up on a hung response with UpstreamError", async () => {
    const src = new AppleMusicTrending({
      fetch: hung as never,
      clock: fakeTime().clock,
      timeoutMs: 20,
    });
    await expect(src.chart("IN")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("AppleMusicTrending", () => {
  const apple = () => {
    const time = fakeTime();
    return {
      adapter: new AppleMusicTrending({ fetch: (...a) => fetch(...a), clock: time.clock }),
      time,
    };
  };

  it("returns the chart with 1-based ranks, cached for a day", async () => {
    let calls = 0;
    server.use(
      http.get(APPLE_URL, () => {
        calls++;
        return HttpResponse.json(applePage);
      }),
    );
    const { adapter, time } = apple();
    await expect(adapter.chart("IN")).resolves.toEqual([
      { title: 'Kesariya (From "Brahmastra")', artistName: "Arijit Singh & Pritam", rank: 1 },
      { title: "Udd Gaye", artistName: "Ritviz", rank: 2 },
    ]);
    await adapter.chart("in");
    expect(calls).toBe(1);
    time.advance(DAY_MS);
    await adapter.chart("IN");
    expect(calls).toBe(2);
  });

  it.each([
    ["a 503", () => new HttpResponse(null, { status: 503 })],
    ["a malformed body", () => HttpResponse.json({ feed: {} })],
  ])("throws UpstreamError on %s", async (_n, reply) => {
    server.use(http.get(APPLE_URL, reply));
    await expect(apple().adapter.chart("IN")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("rejects a malformed market without calling out", async () => {
    await expect(apple().adapter.chart("../x")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("SpotifyNewReleases", () => {
  const ARTIST = asSpotifyArtistId("artistA");
  const OTHER = asSpotifyArtistId("artistB");
  const track = (id: string, artists = [ARTIST]): SpotifyTrack => ({
    id: asSpotifyTrackId(id),
    name: id,
    artistIds: artists,
    albumId: "x",
    albumReleaseDate: null,
    isrc: null,
    durationMs: 1,
    rank: 0,
  });
  const album = (
    id: string,
    releaseDate: string | null,
    albumType: SpotifyAlbum["albumType"] = "single",
  ) => ({ id, name: id, releaseDate, albumType }) as SpotifyAlbum;

  function catalog(): TrackCatalog & { albumCalls: string[] } {
    const albumCalls: string[] = [];
    return {
      albumCalls,
      searchTracks: vi.fn(),
      getArtistAlbums: vi.fn(async () => [
        album("old", "2019-01-01", "album"),
        album("comp", "2026-10-01", "compilation"),
        album("newest", "2026-09-01"),
        album("undated", null),
        album("mid", "2024-05-01", "album"),
      ]),
      getAlbumTracks: vi.fn(async (id: string) => {
        albumCalls.push(id);
        if (id === "newest") return [track("n1"), track("guest", [OTHER])];
        if (id === "mid") return [track("m1"), track("m2"), track("m3")];
        return [track(`${id}1`)];
      }),
    };
  }

  it("takes the artist's own tracks from the newest releases, skipping compilations", async () => {
    const c = catalog();
    const source = new SpotifyNewReleases(c, fakeTime().clock);
    await expect(source.newestTracks(ARTIST, "IN", 3)).resolves.toEqual([
      track("n1"),
      track("m1"),
      track("m2"),
    ]);
    expect(c.albumCalls).toEqual(["newest", "mid"]);
    expect(c.getArtistAlbums).toHaveBeenCalledWith(ARTIST, "IN", { kind: "app" });
    await source.newestTracks(ARTIST, "IN", 3);
    expect(c.getArtistAlbums).toHaveBeenCalledTimes(1);
  });

  it("stops opening releases once it has enough", async () => {
    const c = catalog();
    await new SpotifyNewReleases(c, fakeTime().clock).newestTracks(ARTIST, "IN", 1);
    expect(c.albumCalls).toEqual(["newest"]);
  });
});

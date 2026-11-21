import { http as mock, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { UpstreamError, ValidationError } from "@/lib/errors";
import { SpotifyArtistCatalog, SpotifyTrackCatalog } from "./catalog";
import { SpotifyHttp } from "./spotify-http";
import { FakeClock, fakeSleep, fixedRandom, MemoryGateStore, StaticTokens } from "./test-support";

const API = "https://api.spotify.com/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client() {
  const clock = new FakeClock();
  return new SpotifyHttp({
    fetch: (i, init) => fetch(i, init),
    clock,
    random: fixedRandom(),
    sleep: fakeSleep(clock).sleep,
    gate: new MemoryGateStore(),
    tokens: new StaticTokens(),
  });
}
const artists = () => new SpotifyArtistCatalog(client());
const tracks = () => new SpotifyTrackCatalog(client());
const app = { kind: "app" } as const;

function capture(path: string, body: JsonBodyType) {
  const urls: URL[] = [];
  server.use(
    mock.get(API + path, ({ request }) => {
      urls.push(new URL(request.url));
      return HttpResponse.json(body);
    }),
  );
  return urls;
}

const track = (id: string | null, extra: object = {}) => ({
  id,
  name: `Song ${id}`,
  popularity: 99,
  artists: [{ id: "artistA" }, { id: null }],
  album: { id: "album1", release_date: "2024-05-01" },
  duration_ms: 200_000,
  external_ids: { isrc: `ISRC${id}` },
  ...extra,
});

describe("SpotifyArtistCatalog.searchArtists", () => {
  it("searches type=artist with limit 10 and maps ranks from the offset", async () => {
    const urls = capture("/search", {
      artists: {
        items: [
          {
            id: "a1",
            name: "Prateek Kuhad",
            images: [{ url: "https://i/1" }],
            genres: ["indie"],
            popularity: 80,
            followers: { total: 1 },
          },
          null,
          { id: "a2", name: "Prateek K", images: [] },
        ],
      },
    });
    const result = await artists().searchArtists("Prateek Kuhad", app, { offset: 10 });
    expect(result).toEqual([
      { id: "a1", name: "Prateek Kuhad", rank: 10, imageUrl: "https://i/1", genres: ["indie"] },
      { id: "a2", name: "Prateek K", rank: 11, imageUrl: null, genres: [] },
    ]);
    const p = urls[0]!.searchParams;
    expect([p.get("q"), p.get("type"), p.get("limit"), p.get("offset")]).toEqual([
      "Prateek Kuhad",
      "artist",
      "10",
      "10",
    ]);
  });

  it.each([-1, 1.5, 1001])("rejects offset %d before calling Spotify", async (offset) => {
    const urls = capture("/search", {});
    await expect(artists().searchArtists("x", app, { offset })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects an empty query", async () => {
    await expect(artists().searchArtists("   ", app)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a response missing required fields", async () => {
    capture("/search", { artists: { items: [{ name: "no id" }] } });
    await expect(artists().searchArtists("x", app)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("ids in Spotify responses (LLD §12)", () => {
  it.each(["../me", "../../me/x", "a b", ""])("rejects an artist id %j", async (id) => {
    capture("/search", { artists: { items: [{ id, name: "x" }] } });
    await expect(artists().searchArtists("x", app)).rejects.toBeInstanceOf(UpstreamError);
  });

  it.each([
    ["track id", track("../me")],
    ["artist ref id", track("t1", { artists: [{ id: "../../me/x" }] })],
    ["album id", track("t1", { album: { id: "../me" } })],
  ])("rejects a bad %s in track search", async (_what, item) => {
    capture("/search", { tracks: { items: [item] } });
    await expect(tracks().searchTracks("x", "IN", app)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("rejects a bad album id in artist albums", async () => {
    capture("/artists/artistA/albums", {
      items: [{ id: "../x", name: "LP", album_type: "album" }],
    });
    await expect(
      tracks().getArtistAlbums(asSpotifyArtistId("artistA"), "IN", app),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("SpotifyTrackCatalog", () => {
  it("searches tracks with an explicit market and skips unplayable entries", async () => {
    const urls = capture("/search", {
      tracks: { items: [track("t1"), null, track(null), track("t2", { external_ids: {} })] },
    });
    const result = await tracks().searchTracks('artist:"KK"', "IN", app);
    expect(result).toEqual([
      {
        id: "t1",
        name: "Song t1",
        artistIds: ["artistA"],
        albumId: "album1",
        albumReleaseDate: "2024-05-01",
        isrc: "ISRCt1",
        durationMs: 200_000,
        rank: 0,
      },
      {
        id: "t2",
        name: "Song t2",
        artistIds: ["artistA"],
        albumId: "album1",
        albumReleaseDate: "2024-05-01",
        isrc: null,
        durationMs: 200_000,
        rank: 1,
      },
    ]);
    const p = urls[0]!.searchParams;
    expect([p.get("type"), p.get("limit"), p.get("market")]).toEqual(["track", "10", "IN"]);
  });

  it.each(["in", "IND", ""])("rejects market %j", async (market) => {
    await expect(tracks().searchTracks("x", market, app)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists an artist's albums and singles (limit 10)", async () => {
    const urls = capture("/artists/artistA/albums", {
      items: [
        { id: "al1", name: "LP", release_date: "2023", album_type: "album" },
        {
          id: "al2",
          name: "Feat",
          release_date: null,
          album_type: "album",
          album_group: "appears_on",
        },
        { id: "al3", name: "Odd", album_type: "mixtape" },
      ],
    });
    const result = await tracks().getArtistAlbums(asSpotifyArtistId("artistA"), "IN", app);
    expect(result).toEqual([
      { id: "al1", name: "LP", releaseDate: "2023", albumType: "album" },
      { id: "al2", name: "Feat", releaseDate: null, albumType: "appears_on" },
    ]);
    const p = urls[0]!.searchParams;
    expect([p.get("include_groups"), p.get("limit"), p.get("market")]).toEqual([
      "album,single",
      "10",
      "IN",
    ]);
  });

  it.each(["../me", "a/b", "a b", ""])(
    "rejects artist id %j before calling Spotify",
    async (id) => {
      await expect(
        tracks().getArtistAlbums(asSpotifyArtistId(id), "IN", app),
      ).rejects.toBeInstanceOf(ValidationError);
    },
  );

  it("lists album tracks with the album id and no release date or ISRC", async () => {
    capture("/albums/album9/tracks", {
      items: [{ id: "t1", name: "One", artists: [{ id: "artistA" }], duration_ms: 1000 }],
    });
    await expect(tracks().getAlbumTracks("album9", "IN", app)).resolves.toEqual([
      {
        id: "t1",
        name: "One",
        artistIds: ["artistA"],
        albumId: "album9",
        albumReleaseDate: null,
        isrc: null,
        durationMs: 1000,
        rank: 0,
      },
    ]);
  });
});

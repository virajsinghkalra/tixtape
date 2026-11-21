import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  asSpotifyArtistId,
  asSpotifyPlaylistId,
  asSpotifyTrackId,
  type SpotifyTrackId,
} from "@/domain/shared/ids";
import { SpotifyArtistCatalog, SpotifyTrackCatalog } from "@/infrastructure/spotify/catalog";
import { SpotifyPlaylistWriter } from "@/infrastructure/spotify/playlist-writer";
import { isAppError } from "@/lib/errors";
import { API, httpRig, type HttpRig } from "./fakes";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Seen = { method: string; url: URL; body: unknown; auth: string | null };
let seen: Seen[] = [];
let rig: HttpRig;

function serve(method: "get" | "post" | "put", path: string, body: unknown, status = 200) {
  server.use(
    mock[method](`${API}${path}`, async ({ request }) => {
      const text = await request.text();
      seen.push({
        method: request.method,
        url: new URL(request.url),
        body: text ? JSON.parse(text) : undefined,
        auth: request.headers.get("authorization"),
      });
      return HttpResponse.json(body as never, { status });
    }),
  );
}
/** Catches any request at all, so "no request was made" assertions are meaningful. */
function trap() {
  server.use(
    mock.all(`${API}/*`, ({ request }) => {
      seen.push({ method: request.method, url: new URL(request.url), body: null, auth: null });
      return HttpResponse.json({}, { status: 500 });
    }),
  );
}

afterEach(() => {
  seen = [];
});

const run = <T>(p: Promise<T>) => rig.time.run(p);
/** Either the value or the thrown error, so assertions don't land inside a try/catch. */
async function settle<T>(p: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await rig.time.run(p) };
  } catch (error) {
    return { error };
  }
}
async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await rig.time.run(p);
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

const ID = (n: number) => `4Z8W4fKeB5YxbusRsdQVP${String.fromCharCode(65 + (n % 26))}`;
const page = <T>(items: T[]) => ({
  href: "https://api.spotify.com/v1/x",
  items,
  limit: 10,
  next: null,
  offset: 0,
  previous: null,
  total: items.length,
});
const artist = (n: number) => ({
  id: ID(n),
  name: `Artist ${n}`,
  type: "artist",
  uri: `spotify:artist:${ID(n)}`,
  images: n % 2 ? [] : [{ url: `https://i.scdn.co/image/${n}`, height: 640, width: 640 }],
  genres: ["indie"],
  external_urls: { spotify: "https://open.spotify.com/artist/x" },
});
const track = (n: number, artistIds = [ID(0)]) => ({
  id: ID(n),
  name: `Track ${n}`,
  type: "track",
  uri: `spotify:track:${ID(n)}`,
  duration_ms: 200_000 + n,
  explicit: false,
  artists: artistIds.map((id) => ({ id, name: "A", type: "artist", uri: `spotify:artist:${id}` })),
  album: {
    id: ID(20),
    name: "Album",
    album_type: "album",
    release_date: "2024-05-01",
    release_date_precision: "day",
    images: [],
    artists: [],
  },
  external_ids: { isrc: `USQA1${n}` },
});
const album = (n: number) => ({
  id: ID(n),
  name: `Album ${n}`,
  album_type: "single",
  album_group: "single",
  release_date: "2025",
  release_date_precision: "year",
  total_tracks: 1,
  images: [],
  artists: [],
  type: "album",
  uri: `spotify:album:${ID(n)}`,
});

describe("QA ArtistCatalog.searchArtists (D-007, D-022)", () => {
  it("uses type=artist, limit ≤ 10, maps rank/image/genres", async () => {
    rig = httpRig();
    serve("get", "/search", { artists: page([artist(0), artist(1)]) });
    const res = await run(
      new SpotifyArtistCatalog(rig.http).searchArtists('artist:"Daft Punk"', { kind: "app" }),
    );
    const q = seen[0]!.url.searchParams;
    expect(q.get("type")).toBe("artist");
    expect(Number(q.get("limit"))).toBeGreaterThan(0);
    expect(Number(q.get("limit"))).toBeLessThanOrEqual(10);
    expect(q.get("q")).toBe('artist:"Daft Punk"');
    expect(res.map((r) => r.rank)).toEqual([0, 1]);
    expect(res[0]!.imageUrl).toBe("https://i.scdn.co/image/0");
    expect(res[1]!.imageUrl).toBeNull();
    expect(res[0]!.genres).toEqual(["indie"]);
  });

  it("passes offset through", async () => {
    rig = httpRig();
    serve("get", "/search", { artists: page([artist(0)]) });
    await run(
      new SpotifyArtistCatalog(rig.http).searchArtists("x", { kind: "app" }, { offset: 10 }),
    );
    expect(seen[0]!.url.searchParams.get("offset")).toBe("10");
  });

  it("query with injection characters is URL-encoded, not spliced into the path", async () => {
    rig = httpRig();
    serve("get", "/search", { artists: page([]) });
    const evil = "a&type=track&limit=50#frag/../me";
    await run(new SpotifyArtistCatalog(rig.http).searchArtists(evil, { kind: "app" }));
    const q = seen[0]!.url.searchParams;
    expect(seen[0]!.url.pathname).toBe("/v1/search");
    expect(q.get("q")).toBe(evil);
    expect(q.getAll("type")).toEqual(["artist"]);
    expect(Number(q.get("limit"))).toBeLessThanOrEqual(10);
  });

  it("drops/rejects candidates whose id is not a valid Spotify id (never returns '../me')", async () => {
    // BUG: artist ids in search responses are not validated against SPOTIFY_ID; '../me' is returned to callers (LLD §12: every external payload validated).
    rig = httpRig();
    serve("get", "/search", { artists: page([{ ...artist(0), id: "../me" }, artist(1)]) });
    const r = await settle(new SpotifyArtistCatalog(rig.http).searchArtists("x", { kind: "app" }));
    if (r.error) expect(isAppError(r.error)).toBe(true);
    else expect(r.value!.map((c) => c.id)).not.toContain("../me");
  });

  it.each([
    ["artists missing", {}],
    ["items not an array", { artists: { items: "nope" } }],
    ["item without id", { artists: page([{ name: "x" }]) }],
    ["item name wrong type", { artists: page([{ ...artist(0), name: 42 }]) }],
  ])("malformed response (%s) → clean AppError", async (_n, body) => {
    rig = httpRig();
    serve("get", "/search", body);
    const e = await caught(new SpotifyArtistCatalog(rig.http).searchArtists("x", { kind: "app" }));
    expect(isAppError(e)).toBe(true);
  });

  it("artist search makes exactly one request", async () => {
    rig = httpRig();
    serve("get", "/search", { artists: page([]) });
    await run(new SpotifyArtistCatalog(rig.http).searchArtists("x", { kind: "app" }));
    expect(seen).toHaveLength(1);
  });
});

describe("QA TrackCatalog (D-007, D-022: market on every track call)", () => {
  it("searchTracks: type=track, limit ≤ 10, explicit market, maps fields", async () => {
    rig = httpRig();
    serve("get", "/search", { tracks: page([track(1), track(2, [ID(0), ID(5)])]) });
    const res = await run(
      new SpotifyTrackCatalog(rig.http).searchTracks('artist:"X"', "IN", { kind: "app" }),
    );
    const q = seen[0]!.url.searchParams;
    expect(q.get("type")).toBe("track");
    expect(Number(q.get("limit"))).toBeLessThanOrEqual(10);
    expect(q.get("market")).toBe("IN");
    expect(res[0]).toMatchObject({
      id: ID(1),
      name: "Track 1",
      artistIds: [ID(0)],
      albumId: ID(20),
      albumReleaseDate: "2024-05-01",
      isrc: "USQA11",
      durationMs: 200_001,
      rank: 0,
    });
    expect(res[1]!.artistIds).toEqual([ID(0), ID(5)]);
    expect(res[1]!.rank).toBe(1);
  });

  it("searchTracks: missing external_ids → isrc null, not a crash", async () => {
    rig = httpRig();
    const t = track(1) as Record<string, unknown>;
    delete t.external_ids;
    serve("get", "/search", { tracks: page([t]) });
    const res = await run(
      new SpotifyTrackCatalog(rig.http).searchTracks("x", "IN", { kind: "app" }),
    );
    expect(res[0]!.isrc).toBeNull();
  });

  it("searchTracks: null entries in items (Spotify does this) do not crash with a TypeError", async () => {
    rig = httpRig();
    serve("get", "/search", { tracks: page([null, track(1)]) });
    const r = await settle(
      new SpotifyTrackCatalog(rig.http).searchTracks("x", "IN", { kind: "app" }),
    );
    if (r.error) expect(isAppError(r.error)).toBe(true);
    else expect(r.value!.every((t) => typeof t.id === "string")).toBe(true);
  });

  it("searchTracks: track ids from Spotify that are not valid ids are never returned", async () => {
    // BUG: track ids in search responses are not validated; '../../me/x' is returned as a SpotifyTrackId (LLD §12).
    rig = httpRig();
    serve("get", "/search", { tracks: page([{ ...track(1), id: "../../me/x" }, track(2)]) });
    const r = await settle(
      new SpotifyTrackCatalog(rig.http).searchTracks("x", "IN", { kind: "app" }),
    );
    if (r.error) expect(isAppError(r.error)).toBe(true);
    else expect(r.value!.map((t) => t.id)).not.toContain("../../me/x");
  });

  it("getArtistAlbums: correct path, include_groups album,single, limit ≤ 10, market", async () => {
    rig = httpRig();
    serve("get", `/artists/${ID(3)}/albums`, page([album(1), album(2)]));
    const res = await run(
      new SpotifyTrackCatalog(rig.http).getArtistAlbums(asSpotifyArtistId(ID(3)), "DE", {
        kind: "app",
      }),
    );
    const q = seen[0]!.url.searchParams;
    expect(q.get("market")).toBe("DE");
    expect(q.get("include_groups")?.split(",").sort()).toEqual(["album", "single"]);
    expect(Number(q.get("limit"))).toBeLessThanOrEqual(10);
    expect(res[0]).toMatchObject({
      id: ID(1),
      name: "Album 1",
      releaseDate: "2025",
      albumType: "single",
    });
  });

  it("getAlbumTracks: correct path and market; albumId filled in", async () => {
    rig = httpRig();
    const simplified = (n: number) => {
      const t = track(n) as Record<string, unknown>;
      delete t.album;
      delete t.external_ids;
      return t;
    };
    serve("get", `/albums/${ID(7)}/tracks`, page([simplified(1)]));
    const res = await run(
      new SpotifyTrackCatalog(rig.http).getAlbumTracks(ID(7), "IN", { kind: "app" }),
    );
    expect(seen[0]!.url.searchParams.get("market")).toBe("IN");
    expect(res[0]!.albumId).toBe(ID(7));
    expect(res[0]!.id).toBe(ID(1));
  });

  const badIds = [
    "../me",
    "..%2Fme",
    "%2F",
    "abc/def",
    "abc?x=1",
    "abc#x",
    "",
    " ",
    "ａｂｃ", // full-width unicode
    "abc\u0000",
    "abc\n",
    "a".repeat(200),
    "4Z8W4fKeB5YxbusRsdQVPb/../../me",
  ];
  it.each(badIds)("getArtistAlbums rejects id %j before any request", async (bad) => {
    rig = httpRig();
    trap();
    const e = await caught(
      new SpotifyTrackCatalog(rig.http).getArtistAlbums(asSpotifyArtistId(bad), "IN", {
        kind: "app",
      }),
    );
    expect(isAppError(e)).toBe(true);
    expect(seen).toHaveLength(0);
  });
  it.each(badIds)("getAlbumTracks rejects id %j before any request", async (bad) => {
    rig = httpRig();
    trap();
    const e = await caught(
      new SpotifyTrackCatalog(rig.http).getAlbumTracks(bad, "IN", { kind: "app" }),
    );
    expect(isAppError(e)).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("malformed album page → clean AppError", async () => {
    rig = httpRig();
    serve("get", `/artists/${ID(3)}/albums`, { items: [{ id: 5 }] });
    const e = await caught(
      new SpotifyTrackCatalog(rig.http).getArtistAlbums(asSpotifyArtistId(ID(3)), "IN", {
        kind: "app",
      }),
    );
    expect(isAppError(e)).toBe(true);
  });
});

describe("QA PlaylistWriter (D-007, LLD §7.3)", () => {
  const uid = "00000000-0000-4000-8000-000000000001";
  const pid = asSpotifyPlaylistId(ID(9));
  const ids = (n: number): SpotifyTrackId[] =>
    Array.from({ length: n }, (_, i) => asSpotifyTrackId(ID(i)));

  it("createPlaylist: POST /me/playlists as the user, body passed, maps result", async () => {
    rig = httpRig();
    serve(
      "post",
      "/me/playlists",
      {
        id: ID(9),
        external_urls: { spotify: "https://open.spotify.com/playlist/x" },
        snapshot_id: "s1",
        name: "n",
        type: "playlist",
        uri: `spotify:playlist:${ID(9)}`,
      },
      201,
    );
    const res = await run(
      new SpotifyPlaylistWriter(rig.http).createPlaylist(uid, {
        name: "Lolla 2027",
        description: "d",
        public: false,
      }),
    );
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toMatchObject({ name: "Lolla 2027", description: "d", public: false });
    expect(rig.tokens.calls[0]!.caller).toEqual({ kind: "user", userId: uid });
    expect(res).toEqual({
      id: ID(9),
      url: "https://open.spotify.com/playlist/x",
      snapshotId: "s1",
    });
  });

  it("createPlaylist: a returned playlist id that is not a valid id is rejected", async () => {
    rig = httpRig();
    serve(
      "post",
      "/me/playlists",
      { id: "../../me", external_urls: { spotify: "u" }, snapshot_id: "s" },
      201,
    );
    const e = await caught(
      new SpotifyPlaylistWriter(rig.http).createPlaylist(uid, {
        name: "n",
        description: "",
        public: false,
      }),
    );
    expect(isAppError(e)).toBe(true);
  });

  it("addItems 100 → one POST /playlists/{id}/items with spotify:track URIs", async () => {
    rig = httpRig();
    serve("post", `/playlists/${pid}/items`, { snapshot_id: "s2" }, 201);
    const res = await run(new SpotifyPlaylistWriter(rig.http).addItems(uid, pid, ids(100)));
    expect(seen).toHaveLength(1);
    const body = seen[0]!.body as { uris: string[] };
    expect(body.uris).toHaveLength(100);
    expect(body.uris[0]).toBe(`spotify:track:${ID(0)}`);
    expect(res.snapshotId).toBe("s2");
  });

  it("replaceItems 100 → one PUT", async () => {
    rig = httpRig();
    serve("put", `/playlists/${pid}/items`, { snapshot_id: "s3" });
    await run(new SpotifyPlaylistWriter(rig.http).replaceItems(uid, pid, ids(100)));
    expect(seen[0]!.method).toBe("PUT");
    expect((seen[0]!.body as { uris: string[] }).uris).toHaveLength(100);
  });

  it.each(["addItems", "replaceItems"] as const)(
    "%s with 101 ids is rejected before any request",
    async (m) => {
      rig = httpRig();
      trap();
      const e = await caught(new SpotifyPlaylistWriter(rig.http)[m](uid, pid, ids(101)));
      expect(isAppError(e)).toBe(true);
      expect(seen).toHaveLength(0);
    },
  );

  it("replaceItems [] clears the playlist (PUT with empty uris) or is rejected cleanly", async () => {
    rig = httpRig();
    serve("put", `/playlists/${pid}/items`, { snapshot_id: "s4" });
    const r = await settle(new SpotifyPlaylistWriter(rig.http).replaceItems(uid, pid, []));
    if (r.error) expect(isAppError(r.error)).toBe(true);
    else {
      expect(seen).toHaveLength(1);
      expect((seen[0]!.body as { uris: string[] }).uris).toEqual([]);
    }
  });

  it("addItems [] does not crash (no-op or clean error)", async () => {
    rig = httpRig();
    serve("post", `/playlists/${pid}/items`, { snapshot_id: "s5" }, 201);
    const r = await settle(new SpotifyPlaylistWriter(rig.http).addItems(uid, pid, []));
    if (r.error) expect(isAppError(r.error)).toBe(true);
  });

  it.each(["../me", "%2F", "a/b", "ａｂｃ", ""])(
    "playlist id %j is rejected before any request",
    async (bad) => {
      rig = httpRig();
      trap();
      const e = await caught(
        new SpotifyPlaylistWriter(rig.http).addItems(uid, asSpotifyPlaylistId(bad), ids(1)),
      );
      expect(isAppError(e)).toBe(true);
      expect(seen).toHaveLength(0);
    },
  );

  it.each([`${ID(1)},spotify:track:${ID(2)}`, "spotify:track:x", "../x", "ａｂｃ", ""])(
    "track id %j is rejected before any request (no URI smuggling)",
    async (bad) => {
      rig = httpRig();
      trap();
      const e = await caught(
        new SpotifyPlaylistWriter(rig.http).addItems(uid, pid, [
          asSpotifyTrackId(ID(1)),
          asSpotifyTrackId(bad),
        ]),
      );
      expect(isAppError(e)).toBe(true);
      expect(seen).toHaveLength(0);
    },
  );

  it("malformed snapshot response → clean AppError", async () => {
    rig = httpRig();
    serve("post", `/playlists/${pid}/items`, { snapshot: 1 }, 201);
    const e = await caught(new SpotifyPlaylistWriter(rig.http).addItems(uid, pid, ids(1)));
    expect(isAppError(e)).toBe(true);
  });
});

import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asSpotifyPlaylistId, asSpotifyTrackId } from "@/domain/shared/ids";
import { ValidationError } from "@/lib/errors";
import { SpotifyPlaylistWriter } from "./playlist-writer";
import { SpotifyHttp } from "./spotify-http";
import { FakeClock, fakeSleep, fixedRandom, MemoryGateStore, StaticTokens } from "./test-support";

const API = "https://api.spotify.com/v1";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const clock = new FakeClock();
  const tokens = new StaticTokens();
  const http = new SpotifyHttp({
    fetch: (i, init) => fetch(i, init),
    clock,
    random: fixedRandom(),
    sleep: fakeSleep(clock).sleep,
    gate: new MemoryGateStore(),
    tokens,
  });
  return { tokens, writer: new SpotifyPlaylistWriter(http) };
}

type Seen = { method: string; body: unknown };
function itemsEndpoint(playlistId: string) {
  const seen: Seen[] = [];
  const handler = async ({ request }: { request: Request }) => {
    seen.push({ method: request.method, body: await request.json() });
    return HttpResponse.json({ snapshot_id: `snap-${seen.length}` }, { status: 201 });
  };
  server.use(
    mock.put(`${API}/playlists/${playlistId}/items`, handler),
    mock.post(`${API}/playlists/${playlistId}/items`, handler),
  );
  return seen;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => asSpotifyTrackId(`track${i}`));
const PL = asSpotifyPlaylistId("pl1");

describe("SpotifyPlaylistWriter", () => {
  it("creates a playlist for the user with POST /me/playlists", async () => {
    const { writer, tokens } = setup();
    let body: unknown;
    server.use(
      mock.post(`${API}/me/playlists`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            id: "pl1",
            external_urls: { spotify: "https://open.spotify.com/playlist/pl1" },
            snapshot_id: "s0",
          },
          { status: 201 },
        );
      }),
    );
    const created = await writer.createPlaylist("user-1", {
      name: " Lolla 2026 ",
      description: "d",
      public: false,
    });
    expect(created).toEqual({
      id: "pl1",
      url: "https://open.spotify.com/playlist/pl1",
      snapshotId: "s0",
    });
    expect(body).toEqual({ name: "Lolla 2026", description: "d", public: false });
    expect(tokens.calls[0]?.caller).toEqual({ kind: "user", userId: "user-1" });
  });

  it("rejects an empty or overlong name", async () => {
    const { writer } = setup();
    await expect(
      writer.createPlaylist("u", { name: " ", description: "", public: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      writer.createPlaylist("u", { name: "x".repeat(101), description: "", public: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replaces items with PUT and adds with POST, as track URIs", async () => {
    const { writer } = setup();
    const seen = itemsEndpoint("pl1");
    await expect(writer.replaceItems("u", PL, ids(100))).resolves.toEqual({ snapshotId: "snap-1" });
    await expect(writer.addItems("u", PL, ids(2))).resolves.toEqual({ snapshotId: "snap-2" });
    expect(seen.map((s) => s.method)).toEqual(["PUT", "POST"]);
    expect((seen[0]?.body as { uris: string[] }).uris).toHaveLength(100);
    expect(seen[1]?.body).toEqual({ uris: ["spotify:track:track0", "spotify:track:track1"] });
  });

  it("allows an empty replace (clears the playlist)", async () => {
    const { writer } = setup();
    const seen = itemsEndpoint("pl1");
    await writer.replaceItems("u", PL, []);
    expect(seen[0]?.body).toEqual({ uris: [] });
  });

  it("rejects more than 100 tracks, an empty add, and bad ids before calling Spotify", async () => {
    const { writer } = setup();
    const seen = itemsEndpoint("pl1");
    await expect(writer.replaceItems("u", PL, ids(101))).rejects.toBeInstanceOf(ValidationError);
    await expect(writer.addItems("u", PL, ids(101))).rejects.toBeInstanceOf(ValidationError);
    await expect(writer.addItems("u", PL, [])).rejects.toBeInstanceOf(ValidationError);
    await expect(writer.addItems("u", asSpotifyPlaylistId("../me"), ids(1))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(writer.addItems("u", PL, [asSpotifyTrackId("bad:id")])).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(seen).toHaveLength(0);
  });

  it("reads the first songs back, whichever key Spotify uses for the entry", async () => {
    const { writer } = setup();
    let url = "";
    server.use(
      mock.get(`${API}/playlists/pl1/items`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          items: [
            { track: { name: "Kesariya", artists: [{ name: "Arijit Singh" }] } },
            { item: { name: "Tum Hi Ho", artists: [] } },
            null,
            { track: null },
          ],
        });
      }),
    );
    await expect(writer.readTopItems("u1", PL, 4)).resolves.toEqual([
      { name: "Kesariya", artist: "Arijit Singh" },
      { name: "Tum Hi Ho", artist: "" },
    ]);
    expect(new URL(url).searchParams.get("limit")).toBe("4");
    // Spotify nests the song under `item` now; asking only for `track` returns empty entries.
    expect(new URL(url).searchParams.get("fields")).toContain("item(name");
  });
});

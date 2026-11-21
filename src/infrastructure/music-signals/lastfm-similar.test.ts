import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/errors";
import { LASTFM_BASE_URL } from "./lastfm";
import { LastfmSimilarArtists, similarNames } from "./lastfm-similar";
import { DAY_MS } from "./ttl-cache";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function adapter() {
  let now = Date.parse("2026-11-22T10:00:00Z");
  const a = new LastfmSimilarArtists({
    apiKey: "k",
    fetch: (...args) => fetch(...args),
    sleep: vi.fn(async (ms: number) => {
      now += ms;
    }),
    clock: { now: () => new Date(now) },
  });
  return { a, advance: (ms: number) => (now += ms) };
}

const body = {
  similarartists: {
    artist: [
      { name: "OneRepublic", match: "0.71", url: "https://www.last.fm/music/OneRepublic" },
      { name: "Imagine Dragons", match: "0.93", url: "https://www.last.fm/music/Imagine+Dragons" },
      { name: "coldplay", match: "1" },
      { name: "Keane", match: "junk" },
    ],
    "@attr": { artist: "Coldplay" },
  },
};

describe("similarNames", () => {
  it("sorts by match, drops the artist itself and duplicates, caps", () => {
    expect(
      similarNames(
        "Coldplay",
        [
          { name: "B", match: 0.5 },
          { name: "A", match: 0.9 },
          { name: "COLDPLAY", match: 1 },
          { name: "a", match: 0.4 },
          { name: "C", match: 0.1 },
        ],
        2,
      ),
    ).toEqual(["A", "B"]);
  });
});

describe("LastfmSimilarArtists", () => {
  it("sends artist.getsimilar and maps names, most similar first", async () => {
    const seen: URL[] = [];
    server.use(
      http.get(LASTFM_BASE_URL, ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(body);
      }),
    );
    await expect(adapter().a.similarTo("Coldplay")).resolves.toEqual([
      "Imagine Dragons",
      "OneRepublic",
      "Keane",
    ]);
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({
      method: "artist.getsimilar",
      artist: "Coldplay",
      limit: "15",
      autocorrect: "1",
      api_key: "k",
      format: "json",
    });
  });

  it("accepts Last.fm's one-item bare object", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, () =>
        HttpResponse.json({ similarartists: { artist: { name: "Keane", match: "0.5" } } }),
      ),
    );
    await expect(adapter().a.similarTo("Coldplay")).resolves.toEqual(["Keane"]);
  });

  it("an unknown artist is an empty list", async () => {
    server.use(
      http.get(LASTFM_BASE_URL, () =>
        HttpResponse.json({ error: 6, message: "The artist you supplied could not be found" }),
      ),
    );
    await expect(adapter().a.similarTo("Zzzq")).resolves.toEqual([]);
  });

  it("caches per artist for 7 days", async () => {
    let calls = 0;
    server.use(
      http.get(LASTFM_BASE_URL, () => {
        calls++;
        return HttpResponse.json(body);
      }),
    );
    const { a, advance } = adapter();
    await a.similarTo("Coldplay");
    await a.similarTo(" coldplay ");
    expect(calls).toBe(1);
    advance(7 * DAY_MS + 1);
    await a.similarTo("Coldplay");
    expect(calls).toBe(2);
  });

  it("a 5xx or bad body throws UpstreamError (and isn't cached)", async () => {
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json({ nope: true }, { status: 500 })));
    const { a } = adapter();
    await expect(a.similarTo("Coldplay")).rejects.toBeInstanceOf(UpstreamError);
    server.use(http.get(LASTFM_BASE_URL, () => HttpResponse.json(body)));
    await expect(a.similarTo("Coldplay")).resolves.toHaveLength(3);
  });
});

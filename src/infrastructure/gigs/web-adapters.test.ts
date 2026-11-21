import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LastfmClient } from "../music-signals/lastfm";
import { createMemoryHostLog, PoliteFetcher } from "../sources/polite-fetch";
import {
  LastfmTrendingArtists,
  PolitePageReader,
  tourLinks,
  WikidataOfficialSites,
} from "./web-adapters";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const now = new Date("2026-11-21T10:00:00Z");
function fetcher() {
  let t = now.getTime();
  return new PoliteFetcher({
    fetch: (...args) => fetch(...args),
    sleep: async (ms) => {
      t += ms;
    },
    clock: { now: () => new Date(t) },
    logger: { warn: vi.fn() },
    hostLog: createMemoryHostLog(),
    resolve: async () => ["93.184.216.34"],
  });
}
const html = (body: string, status = 200) =>
  new HttpResponse(body, { status, headers: { "content-type": "text/html" } });
const json = (body: unknown) =>
  new HttpResponse(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("PolitePageReader", () => {
  it("returns title, text, JSON-LD and same-host tour links", async () => {
    server.use(
      http.get("https://artist.example/robots.txt", () => new HttpResponse("", { status: 404 })),
      http.get("https://artist.example/", () =>
        html(`<html><head><title>Artist &amp; Band</title>
          <script type="application/ld+json">{"@type":"MusicEvent","name":"Artist","startDate":"2026-12-05"}</script></head>
          <body><p>Hello</p><a href="/tour">Tour</a><a href="https://other.example/live">Live</a><a href="/about">About</a></body></html>`),
      ),
    );
    const page = await new PolitePageReader(fetcher()).read("https://artist.example/");
    expect(page).toMatchObject({
      status: "ok",
      title: "Artist & Band",
      tourLinks: ["https://artist.example/tour"],
      jsonLd: [{ "@type": "MusicEvent" }],
    });
  });

  it("reports a 404 as gone", async () => {
    server.use(
      http.get("https://artist.example/robots.txt", () => new HttpResponse("", { status: 404 })),
      http.get("https://artist.example/old", () => html("gone", 404)),
    );
    expect(await new PolitePageReader(fetcher()).read("https://artist.example/old")).toEqual({
      status: "gone",
      url: "https://artist.example/old",
    });
  });

  it.each([
    "https://in.bookmyshow.com/events/x",
    "https://linktr.ee/bhuwin",
    "https://www.district.in/events/x",
    "https://allevents.in/mumbai/x",
  ])("refuses a denied site without any request: %s", async (url) => {
    await expect(new PolitePageReader(fetcher()).read(url)).rejects.toThrow(/may not be read/u);
  });
});

describe("tourLinks", () => {
  it("keeps at most five same-host tour-like links", () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/shows/${i}">x</a>`).join("");
    expect(tourLinks(links, "https://a.example/")).toHaveLength(5);
  });
});

describe("WikidataOfficialSites", () => {
  it("finds P856 through the Spotify ID and drops denied domains", async () => {
    server.use(
      http.get("https://www.wikidata.org/w/api.php", ({ request }) => {
        const action = new URL(request.url).searchParams.get("action");
        if (action === "query") return json({ query: { search: [{ title: "Q42" }] } });
        return json({
          entities: {
            Q42: {
              claims: {
                P856: [
                  { mainsnak: { datavalue: { value: "https://prateekkuhad.com" } } },
                  { mainsnak: { datavalue: { value: "https://linktr.ee/prateek" } } },
                  { mainsnak: { datavalue: { value: "javascript:alert(1)" } } },
                ],
              },
            },
          },
        });
      }),
    );
    const sites = new WikidataOfficialSites({
      fetcher: fetcher(),
      cache: null,
      clock: { now: () => now },
    });
    expect(await sites.sitesOf("0tC995Rfn9k2l7nqgCZsV7")).toEqual(["https://prateekkuhad.com"]);
    expect(await sites.sitesOf("not-an-id")).toEqual([]);
  });

  it("returns nothing for an artist without a Wikidata item", async () => {
    server.use(
      http.get("https://www.wikidata.org/w/api.php", () => json({ query: { search: [] } })),
    );
    const sites = new WikidataOfficialSites({
      fetcher: fetcher(),
      cache: null,
      clock: { now: () => now },
    });
    expect(await sites.sitesOf("6vsLn0UxL3GhtYP7ghpF3t")).toEqual([]);
  });
});

describe("LastfmTrendingArtists", () => {
  it("reads geo.getTopArtists for India", async () => {
    server.use(
      http.get("https://ws.audioscrobbler.com/2.0/", ({ request }) => {
        const q = new URL(request.url).searchParams;
        expect(q.get("method")).toBe("geo.gettopartists");
        expect(q.get("country")).toBe("India");
        return json({ topartists: { artist: [{ name: "Pritam", listeners: "6975" }] } });
      }),
    );
    const client = new LastfmClient({
      apiKey: "k",
      fetch: (...a) => fetch(...a),
      sleep: async () => {},
      clock: { now: () => now },
    });
    expect(await new LastfmTrendingArtists(client).topInIndia(10)).toEqual([
      { name: "Pritam", listeners: 6975 },
    ]);
  });
});

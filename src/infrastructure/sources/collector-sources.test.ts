import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CandidateSource } from "@/application/ingestion/ports";
import type { EventCandidate } from "@/domain/events/extract/candidate";
import { UpstreamError } from "@/lib/errors";
import {
  CrawlDelayError,
  createMemoryHostLog,
  PoliteFetcher,
  RobotsDisallowedError,
  USER_AGENT,
  type HostLog,
} from "./polite-fetch";
import { POLLSTAR_FEED, PollstarSource } from "./pollstar";
import { parseRobots } from "./robots";
import {
  ROLLING_STONE_FEED,
  ROLLING_STONE_TAG_FEEDS,
  RollingStoneIndiaSource,
  rollingStoneFeedFor,
} from "./rollingstone";
import { SUNBURN_EVENTS_URL, SUNBURN_POSTS_URL, SunburnSource } from "./sunburn";
import { TEAM_INNOVATION_URL, TeamInnovationSource } from "./teaminnovation";
import { WIKIPEDIA_API, WikipediaSource } from "./wikipedia";

const fixture = (path: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${path}`, import.meta.url)), "utf8");

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A clock that only moves when someone sleeps. */
function fakeTime(start = Date.parse("2026-11-21T10:00:00Z")) {
  let now = start;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  return { clock: { now: () => new Date(now) }, sleep, advance: (ms: number) => (now += ms) };
}

/** Every test host "resolves" to a public address; no real DNS in tests. */
const publicDns = async () => ["93.184.216.34"];

/** Fake documents with the content types real sites send (the fetcher checks them). */
const doc = (body: string, type: string) =>
  new HttpResponse(body, { headers: { "content-type": type } });
const html = (body: string) => doc(body, "text/html; charset=UTF-8");
const rss = (body: string) => doc(body, "application/rss+xml; charset=UTF-8");
const jsonDoc = (body: string) => doc(body, "application/json; charset=UTF-8");

function fetcher(hostLog: HostLog = createMemoryHostLog(), time = fakeTime()) {
  const logger = { warn: vi.fn() };
  const f = new PoliteFetcher({
    fetch: (...args) => fetch(...args),
    sleep: time.sleep,
    clock: time.clock,
    logger,
    hostLog,
    resolve: publicDns,
  });
  return { fetcher: f, time, logger, hostLog };
}

async function collect(source: CandidateSource, now: Date, watchTerms?: string[]) {
  const out: EventCandidate[] = [];
  for await (const c of source.collect({ now, watchTerms })) out.push(c);
  return out;
}

const robots = (host: string, body: string, status = 200) =>
  http.get(`https://${host}/robots.txt`, () => new HttpResponse(body, { status }));

describe("parseRobots", () => {
  const text = [
    "User-agent: Googlebot",
    "Disallow: /",
    "",
    "User-agent: *",
    "Disallow: /wp-admin/",
    "Allow: /wp-admin/admin-ajax.php",
    "Disallow: /*.pdf$",
    "Crawl-delay: 600",
  ].join("\n");

  it.each([
    ["/feed/", true],
    ["/wp-admin/x", false],
    ["/wp-admin/admin-ajax.php", true],
    ["/files/a.pdf", false],
    ["/files/a.pdf?x", true],
  ])("%s → %s", (path, allowed) => {
    expect(parseRobots(text, "lineupmixes").allows(path)).toBe(allowed);
  });

  it("reads Crawl-delay and treats an empty file as allow-all", () => {
    expect(parseRobots(text, "lineupmixes").crawlDelaySeconds).toBe(600);
    expect(parseRobots("", "lineupmixes").allows("/anything")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow:", "lineupmixes").allows("/x")).toBe(true);
  });
});

describe("PoliteFetcher", () => {
  it("sends the identifying User-Agent and honours robots.txt", async () => {
    const agents: (string | null)[] = [];
    server.use(
      robots("example.org", "User-agent: *\nDisallow: /private/"),
      http.get("https://example.org/feed", ({ request }) => {
        agents.push(request.headers.get("user-agent"));
        return html("ok");
      }),
    );
    const { fetcher: f } = fetcher();
    expect(await f.getText("https://example.org/feed", { accept: "text/plain" })).toBe("ok");
    expect(agents).toEqual([USER_AGENT]);
    expect(USER_AGENT).not.toMatch(/@/u);
    await expect(
      f.getText("https://example.org/private/x", { accept: "text/plain" }),
    ).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("backs off a host for the rest of the run after HTTP 429", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.example.org/x", () => {
        calls++;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    const { fetcher: f } = fetcher();
    const opts = { accept: "*/*", policy: "api-etiquette" as const };
    await expect(f.getText("https://api.example.org/x", opts)).rejects.toThrow(/429/u);
    await expect(f.getText("https://api.example.org/x", opts)).rejects.toThrow(/slow down/u);
    expect(calls).toBe(1);
  });

  it("refuses non-http URLs", async () => {
    const { fetcher: f } = fetcher();
    await expect(f.getText("ftp://example.org/x", { accept: "*/*" })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it("keeps at least one second between requests to a host", async () => {
    server.use(
      robots("example.org", ""),
      http.get("https://example.org/a", () => html("a")),
    );
    const { fetcher: f, time } = fetcher();
    await f.getText("https://example.org/a", { accept: "*/*" });
    await f.getText("https://example.org/a", { accept: "*/*" });
    // robots.txt, then two pages: each wait is the rest of the one-second window.
    expect(time.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000]);
  });

  it("holds a long crawl-delay across runs instead of sleeping", async () => {
    server.use(
      robots("example.org", "User-agent: *\nCrawl-delay: 600"),
      http.get("https://example.org/feed", () => html("feed")),
    );
    const hostLog = createMemoryHostLog();
    const time = fakeTime();
    await fetcher(hostLog, time).fetcher.getText("https://example.org/feed", { accept: "*/*" });
    time.advance(60_000);
    // A new run (new fetcher) shares the host log, like the file-backed state.
    await expect(
      fetcher(hostLog, time).fetcher.getText("https://example.org/feed", { accept: "*/*" }),
    ).rejects.toBeInstanceOf(CrawlDelayError);
    time.advance(600_000);
    expect(
      await fetcher(hostLog, time).fetcher.getText("https://example.org/feed", { accept: "*/*" }),
    ).toBe("feed");
  });

  it("times out a request that hangs", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );
    const time = fakeTime();
    const f = new PoliteFetcher({
      fetch: hanging,
      sleep: time.sleep,
      clock: time.clock,
      logger: { warn: vi.fn() },
      hostLog: createMemoryHostLog(),
      timeoutMs: 5,
      resolve: publicDns,
    });
    await expect(
      f.getText("https://example.org/x", { accept: "*/*", policy: "api-etiquette" }),
    ).rejects.toThrow(/could not be reached/u);
  });

  it("a server error on robots.txt stops the source; a 404 allows everything", async () => {
    server.use(robots("down.example", "", 503), robots("open.example", "", 404));
    server.use(http.get("https://open.example/x", () => html("x")));
    const { fetcher: f } = fetcher();
    await expect(f.getText("https://down.example/x", { accept: "*/*" })).rejects.toThrow(/503/u);
    expect(await f.getText("https://open.example/x", { accept: "*/*" })).toBe("x");
  });
});

describe("RollingStoneIndiaSource", () => {
  const now = new Date("2026-11-21T10:00:00Z");

  it("reads exactly one feed per run, alternating main and tag feeds", () => {
    const slot = 3 * 3_600_000;
    const even = new Date(Math.floor(now.getTime() / slot / 2) * 2 * slot);
    expect(rollingStoneFeedFor(even)).toBe(ROLLING_STONE_FEED);
    expect(ROLLING_STONE_TAG_FEEDS).toContain(rollingStoneFeedFor(new Date(even.getTime() + slot)));
  });

  it("tag slots go first to series still missing a lineup", () => {
    const slot = 3 * 3_600_000;
    const odd = new Date((Math.floor(now.getTime() / slot / 2) * 2 + 1) * slot);
    expect(rollingStoneFeedFor(odd, ["Sunburn Festival 2026"])).toBe(
      "https://rollingstoneindia.com/tag/sunburn/feed/",
    );
    expect(rollingStoneFeedFor(new Date(odd.getTime() - slot), ["Sunburn Festival 2026"])).toBe(
      ROLLING_STONE_FEED,
    );
    expect(ROLLING_STONE_TAG_FEEDS).toContain(rollingStoneFeedFor(odd, ["Unknown Fest 2026"]));
  });

  it("reads the Sunburn 2026 headliners from the real tag feed", async () => {
    server.use(
      robots("rollingstoneindia.com", "User-agent: *\nCrawl-delay: 600"),
      http.get("https://rollingstoneindia.com/*", () =>
        rss(fixture("rollingstone/tag-sunburn.xml")),
      ),
    );
    const { fetcher: f, logger } = fetcher();
    const found = await collect(new RollingStoneIndiaSource({ fetcher: f, logger }), now);
    const sunburn = found.find((c) => c.title === "Sunburn Festival 2026")!;
    expect(sunburn).toMatchObject({
      city: "Mumbai",
      venueName: "Mahalaxmi Racecourse",
      startsAt: new Date("2026-12-18T00:00:00+05:30"),
      endsAt: new Date("2026-12-19T00:00:00+05:30"),
      dateExplicit: true,
    });
    const all = sunburn.artists.flatMap(function names(m): string[] {
      return [m.name, ...m.parts.flatMap(names)];
    });
    expect(all).toEqual(
      expect.arrayContaining(["DJ Snake", "The Chainsmokers", "Sebastian Ingrosso"]),
    );
  });

  it("extracts the Johnnie & Co. Festival announcement from the real feed", async () => {
    const requests: string[] = [];
    server.use(
      robots("rollingstoneindia.com", "User-agent: *\nCrawl-delay: 600"),
      http.get("https://rollingstoneindia.com/*", ({ request }) => {
        requests.push(request.url);
        return new HttpResponse(fixture("rollingstone/feed.xml"), {
          headers: { "content-type": "application/rss+xml" },
        });
      }),
    );
    const { fetcher: f, logger } = fetcher();
    const found = await collect(new RollingStoneIndiaSource({ fetcher: f, logger }), now);
    expect(requests).toHaveLength(1);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "rollingstone",
      trust: "trusted",
      externalId: "https://rollingstoneindia.com/?p=179385",
      url: "https://rollingstoneindia.com/charlie-puth-ellie-goulding-india-debut-mumbai/",
      title: "Johnnie & Co. Festival",
      startsAt: new Date("2027-02-13T00:00:00+05:30"),
      city: "Mumbai",
      venueName: "Mahalaxmi Racecourse",
    });
    const names = found[0]!.artists.flatMap(function all(m): string[] {
      return [m.name, ...m.parts.flatMap(all)];
    });
    expect(names).toEqual(
      expect.arrayContaining([
        "Charlie Puth",
        "Ellie Goulding",
        "Kayan",
        "Gini",
        "Mali",
        "Taba Chake",
      ]),
    );
  });

  it("skips malformed items and fails the run on a non-feed body", async () => {
    server.use(
      robots("rollingstoneindia.com", ""),
      http.get("https://rollingstoneindia.com/*", () =>
        rss(
          "<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>",
        ),
      ),
    );
    const { fetcher: f, logger } = fetcher();
    expect(await collect(new RollingStoneIndiaSource({ fetcher: f, logger }), now)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0 }),
      "rollingstone: skipped malformed item",
    );
    server.use(http.get("https://rollingstoneindia.com/*", () => html("<html/>")));
    await expect(
      collect(new RollingStoneIndiaSource({ fetcher: fetcher().fetcher, logger }), now),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("PollstarSource", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  const serveFeed = (xml: string) =>
    server.use(
      robots("news.pollstar.com", "User-agent: *\nCrawl-delay: 10"),
      http.get(POLLSTAR_FEED, () => rss(xml)),
    );

  it("ignores items not about India (the real feed has none today)", async () => {
    serveFeed(fixture("pollstar/feed.xml"));
    const { fetcher: f, logger } = fetcher();
    expect(await collect(new PollstarSource({ fetcher: f, logger }), now)).toEqual([]);
  });

  it("reads an India item", async () => {
    // Synthetic item (the captured feed has no India story); shape copied from the real feed.
    serveFeed(
      `<rss><channel><item><title>Prateek Kuhad Announces Mumbai Show</title><link>https://news.pollstar.com/2026/11/20/x/</link><guid>https://news.pollstar.com/?p=1</guid><content:encoded><![CDATA[<p>Prateek Kuhad will perform at NSCI Dome in Mumbai on Dec. 12, 2026.</p>]]></content:encoded></item></channel></rss>`,
    );
    const { fetcher: f, logger } = fetcher();
    const found = await collect(new PollstarSource({ fetcher: f, logger }), now);
    expect(found[0]).toMatchObject({ source: "pollstar", city: "Mumbai", venueName: "NSCI Dome" });
  });
});

describe("WikipediaSource", () => {
  const parseHandler = (pages: Record<string, unknown>) =>
    http.get(WIKIPEDIA_API, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("action") === "query") {
        return HttpResponse.json({
          query: { search: [{ title: "Music of the Spheres World Tour", pageid: 7 }] },
        });
      }
      const page = pages[url.searchParams.get("page") ?? ""];
      return HttpResponse.json(page ?? { error: { code: "missingtitle", info: "missing" } });
    });

  it("reads edition facts and keeps the attribution URL", async () => {
    server.use(
      parseHandler({ "NH7 Weekender": JSON.parse(fixture("wikipedia/NH7_Weekender.json")) }),
    );
    const { fetcher: f, logger } = fetcher();
    const source = new WikipediaSource({
      fetcher: f,
      logger,
      festivals: [
        { page: "NH7 Weekender", eventName: "NH7 Weekender" },
        { page: "Nope", eventName: "Nope" },
      ],
    });
    const found = await collect(source, new Date("2019-10-01T00:00:00Z"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: "wikipedia",
      // D-070: openly editable, so a trusted outlet, never official.
      trust: "trusted",
      title: "NH7 Weekender 2019",
      url: "https://en.wikipedia.org/wiki/NH7_Weekender",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ page: "Nope", code: "missingtitle" }),
      "wikipedia: page not available",
    );
  });

  it("fails the source on a malformed API response", async () => {
    server.use(http.get(WIKIPEDIA_API, () => HttpResponse.json({ parse: { title: 1 } })));
    const { fetcher: f, logger } = fetcher();
    const source = new WikipediaSource({
      fetcher: f,
      logger,
      festivals: [{ page: "NH7 Weekender", eventName: "NH7 Weekender" }],
    });
    await expect(collect(source, new Date())).rejects.toBeInstanceOf(UpstreamError);
  });

  it("live lookup: searches, then reads Indian dates from a tour table", async () => {
    const wikitext = [
      "{{Infobox concert",
      "| concert_tour_name = Music of the Spheres World Tour",
      "| artist = [[Coldplay]]",
      "}}",
      "'''Music of the Spheres World Tour''' is a concert tour by [[Coldplay]].",
      "== Shows ==",
      '{| class="wikitable"',
      "! Date !! City !! Country !! Venue !! Opening acts",
      "|-",
      "| 18 January 2027 || [[Mumbai]] || India || [[DY Patil Stadium]] || [[Jasleen Royal]]",
      "|-",
      "| 22 January 2027 || [[Abu Dhabi]] || UAE || Zayed Sports City || —",
      "|-",
      "| 25 January || [[Delhi]] || India || JLN Stadium || —",
      "|}",
    ].join("\n");
    server.use(
      parseHandler({
        "Music of the Spheres World Tour": {
          parse: { title: "Music of the Spheres World Tour", pageid: 7, wikitext },
        },
      }),
    );
    const { fetcher: f, logger } = fetcher();
    const found = await new WikipediaSource({ fetcher: f, logger, festivals: [] }).lookUp(
      "Coldplay",
      new Date("2026-11-21T10:00:00Z"),
    );
    expect(found).toHaveLength(1);
    // The Delhi row has no year anywhere (cell, header, caption, heading): dropped (D-054).
    expect(found[0]).toMatchObject({
      title: "Coldplay – Music of the Spheres World Tour",
      type: "concert",
      city: "Mumbai",
      venueName: "DY Patil Stadium",
      startsAt: new Date("2027-01-18T00:00:00+05:30"),
      dateExplicit: true,
      artists: [
        { name: "Coldplay", parts: [] },
        { name: "Jasleen Royal", parts: [], role: "support" },
      ],
      url: "https://en.wikipedia.org/wiki/Music_of_the_Spheres_World_Tour",
    });
  });
});

describe("SunburnSource", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  const serve = (
    posts: () => Response,
    events: () => Response = () => jsonDoc(fixture("sunburn/events.json")),
  ) =>
    server.use(
      robots("sunburn.in", "User-Agent: *\nDisallow:"),
      http.get(SUNBURN_EVENTS_URL, events),
      http.get(SUNBURN_POSTS_URL.split("?")[0]!, posts),
    );

  it("reads official single-city shows from the real Events Calendar API, then posts", async () => {
    serve(() => jsonDoc(fixture("sunburn/posts.json")));
    const { fetcher: f, logger } = fetcher();
    const found = await collect(new SunburnSource({ fetcher: f, logger }), now);
    expect(found.map((c) => [c.externalId, c.title, c.city, c.venueName, c.type])).toEqual([
      ["event:23142", "Anyma Presents Aeden – Mumbai", "Mumbai", "Mahalaxmi Racecourse", "concert"],
      ["event:23439", "Sunburn Festival 2026", "Mumbai", "Mahalaxmi Racecourse", "festival"],
      ["event:23525", "Sunburn Arena ft. DJ Snake – Bangalore", "Bengaluru", null, "concert"],
      ["event:23451", "Sunburn Arena ft. The Chainsmokers", "Bengaluru", null, "concert"],
      ["post:23421", "Sunburn Festival 2026", "Mumbai", "Mahalaxmi Racecourse", "festival"],
    ]);
    // Multi-city tours, shows without a city (Alesso, closing party) are skipped.
    expect(found[1]).toMatchObject({
      startsAt: new Date("2026-12-18T00:00:00+05:30"),
      endsAt: new Date("2026-12-19T00:00:00+05:30"),
      dateExplicit: true,
      artists: [],
      url: "https://sunburn.in/event/sunburn-festival-2026/",
    });
    expect(found[0]!.artists).toEqual([{ name: "Anyma", parts: [] }]);
    expect(found[2]!.artists).toEqual([{ name: "DJ Snake", parts: [] }]);
  });

  it("skips a malformed post or event", async () => {
    const posts = JSON.parse(fixture("sunburn/posts.json"));
    const events = JSON.parse(fixture("sunburn/events.json"));
    serve(
      () => HttpResponse.json([{ id: "nope" }, ...posts]),
      () => HttpResponse.json({ ...events, events: [{ id: "x" }, ...events.events] }),
    );
    const { fetcher: f, logger } = fetcher();
    const found = await collect(new SunburnSource({ fetcher: f, logger }), now);
    expect(found).toHaveLength(5);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "sunburn: skipped malformed post");
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), "sunburn: skipped malformed event");
  });
});

describe("TeamInnovationSource", () => {
  it("reads single-city shows from the real cards and their detail pages", async () => {
    server.use(
      robots("teaminnovation.in", "", 404),
      http.get(TEAM_INNOVATION_URL, () => html(fixture("teaminnovation/upcoming-events.html"))),
      http.get(
        "https://teaminnovation.in/upcoming-show/charlie-puth-johnnie-music-festival.html",
        () => html(fixture("teaminnovation/johnnie-detail.html")),
      ),
      http.get(
        "https://teaminnovation.in/upcoming-show/home-festival-2026.html",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const { fetcher: f, logger } = fetcher();
    const found = await collect(
      new TeamInnovationSource({ fetcher: f, logger }),
      new Date("2026-11-21T10:00:00Z"),
    );
    expect(
      found.map((c) => [
        c.title,
        c.city,
        c.venueName,
        c.startsAt.toISOString(),
        c.endsAt?.toISOString() ?? null,
      ]),
    ).toEqual([
      [
        "Johnnie & Co. Music Festival",
        "Mumbai",
        "Mahalaxmi Racecourse",
        "2027-02-12T18:30:00.000Z",
        null,
      ],
      ["HOME Festival 2026", "Goa", null, "2026-12-28T18:30:00.000Z", "2026-12-29T18:30:00.000Z"],
    ]);
    const show = (m: { name: string; parts: readonly { name: string }[] }) =>
      m.parts.length ? `${m.name}(${m.parts.map((p) => p.name).join(", ")})` : m.name;
    // The official page names the whole lineup ("…alongside an exciting lineup featuring…").
    expect(found[0]!.artists.map(show)).toEqual([
      "Charlie Puth",
      "Charlie Puth",
      "Ellie Goulding",
      "GINI",
      "KAYAN",
      "MALI and Taba Chake(MALI, Taba Chake)",
    ]);
    expect(found[0]).toMatchObject({
      trust: "official",
      externalId: "upcoming-show/charlie-puth-johnnie-music-festival",
    });
    // A failed detail page keeps the card and is logged.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://teaminnovation.in/upcoming-show/home-festival-2026.html",
      }),
      "teaminnovation: detail page failed",
    );
  });

  it("fails the run when the page has no cards (layout changed)", async () => {
    server.use(
      robots("teaminnovation.in", "", 404),
      http.get(TEAM_INNOVATION_URL, () => html("<html><body>Maintenance</body></html>")),
    );
    const { fetcher: f, logger } = fetcher();
    await expect(
      collect(new TeamInnovationSource({ fetcher: f, logger }), new Date("2026-11-21T10:00:00Z")),
    ).rejects.toBeInstanceOf(UpstreamError);
  });
});

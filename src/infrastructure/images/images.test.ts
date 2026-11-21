import { describe, expect, it } from "vitest";
import type { ImageSubject } from "@/domain/images/image";
import { OfficialPosterProvider, StoredSpotifyImageProvider } from "./basic-providers";
import { HttpImageLinkChecker } from "./link-checker";
import { parseEntities, WikimediaImageProvider, type JsonFetcher } from "./wikimedia-provider";

type Entity = {
  label: string;
  aliases?: string[];
  P31?: string[];
  P106?: string[];
  P18?: string;
  P1902?: string;
  enwiki?: string;
};

const snak = (v: string | { id: string }) => ({ mainsnak: { datavalue: { value: v } } });
const entityJson = (e: Entity) => ({
  labels: { en: { value: e.label } },
  aliases: { en: (e.aliases ?? []).map((value) => ({ value })) },
  claims: {
    P31: (e.P31 ?? ["Q5"]).map((id) => snak({ id })),
    P106: (e.P106 ?? ["Q177220"]).map((id) => snak({ id })),
    ...(e.P18 ? { P18: [snak(e.P18)] } : {}),
    ...(e.P1902 ? { P1902: [snak(e.P1902)] } : {}),
  },
  sitelinks: e.enwiki ? { enwiki: { title: e.enwiki } } : {},
});

/** Answers MediaWiki API calls from fixtures; records every URL. */
function fakeWiki(opts: {
  search?: Record<string, string[]>;
  bySpotify?: Record<string, string[]>;
  entities: Record<string, Entity>;
  files?: Record<string, { url: string; width: number; license?: string; artist?: string }>;
  summaries?: Record<string, string>;
}): JsonFetcher & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async getText(raw) {
      urls.push(raw);
      const url = new URL(raw);
      const p = url.searchParams;
      if (url.hostname === "en.wikipedia.org") {
        const title = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/_/gu, " ");
        const source = opts.summaries?.[title];
        return JSON.stringify(source ? { originalimage: { source } } : {});
      }
      if (p.get("action") === "wbsearchentities") {
        return JSON.stringify({
          search: (opts.search?.[p.get("search") ?? ""] ?? []).map((id) => ({ id })),
        });
      }
      if (p.get("list") === "search") {
        const id = (p.get("srsearch") ?? "").split("=")[1] ?? "";
        return JSON.stringify({
          query: { search: (opts.bySpotify?.[id] ?? []).map((title) => ({ title })) },
        });
      }
      if (p.get("action") === "wbgetentities") {
        const ids = (p.get("ids") ?? "").split("|");
        return JSON.stringify({
          entities: Object.fromEntries(
            ids.filter((id) => opts.entities[id]).map((id) => [id, entityJson(opts.entities[id]!)]),
          ),
        });
      }
      if (url.hostname === "commons.wikimedia.org") {
        const file = (p.get("titles") ?? "").replace(/^File:/u, "");
        const f = opts.files?.[file];
        const imageinfo = f
          ? [
              {
                url: f.url,
                width: f.width,
                extmetadata: {
                  ...(f.artist ? { Artist: { value: f.artist } } : {}),
                  ...(f.license ? { LicenseShortName: { value: f.license } } : {}),
                },
              },
            ]
          : undefined;
        return JSON.stringify({
          query: { pages: { "1": { ...(imageinfo ? { imageinfo } : {}) } } },
        });
      }
      throw new Error(`unexpected ${raw}`);
    },
  };
}

const artist = (name: string, spotifyId: string | null = null): ImageSubject => ({
  kind: "artist",
  name,
  spotifyId,
  mbid: null,
  spotifyImageUrl: null,
});

const SHREYA_FILE = "Shreya Ghoshal (cropped).jpg";
const SHREYA_ORIGINAL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Shreya_Ghoshal_%28cropped%29.jpg";
const shreyaWiki = () =>
  fakeWiki({
    search: { "Shreya Ghoshal": ["Q7503728", "Q2050788"] },
    bySpotify: { "0oOet2f43PA68X5RxKobEy": ["Q2050788"] },
    entities: {
      Q2050788: { label: "Shreya Ghoshal", P18: SHREYA_FILE, P1902: "0oOet2f43PA68X5RxKobEy" },
      Q7503728: { label: "Shreya Ghoshal discography", P31: ["Q273057"], P106: [] },
    },
    files: {
      [SHREYA_FILE]: {
        url: SHREYA_ORIGINAL,
        width: 1200,
        license: "CC BY 3.0",
        artist: '<a href="x">Behindwoods</a>',
      },
    },
  });

describe("WikimediaImageProvider", () => {
  it("finds the photo of the artist linked by Spotify ID, with its credit", async () => {
    const wiki = shreyaWiki();
    const found = await new WikimediaImageProvider(wiki).find(
      artist("Shreya Ghoshal", "0oOet2f43PA68X5RxKobEy"),
    );
    expect(found).toEqual({
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Shreya_Ghoshal_%28cropped%29.jpg/500px-Shreya_Ghoshal_%28cropped%29.jpg",
      credit: "Photo: Behindwoods, CC BY 3.0, Wikimedia Commons",
      license: "CC BY 3.0",
      source: "wikimedia",
      confidence: 1,
      evidence: ["Q2050788: P1902 Spotify ID matches", `P18 ${SHREYA_FILE}`],
    });
  });

  it("finds it by name alone with lower confidence", async () => {
    const found = await new WikimediaImageProvider(shreyaWiki()).find(artist("Shreya Ghoshal"));
    expect(found?.confidence).toBe(0.8);
  });

  it("uses the Wikipedia summary image when there is no P18", async () => {
    const wiki = fakeWiki({
      search: { "Yussef Dayes": ["Q96362639"] },
      entities: { Q96362639: { label: "Yussef Dayes", P106: ["Q386854"], enwiki: "Yussef Dayes" } },
      summaries: {
        "Yussef Dayes":
          "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Yussef_Dayes.jpg/320px-Yussef_Dayes.jpg",
      },
      files: {
        "Yussef Dayes.jpg": {
          url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Yussef_Dayes.jpg",
          width: 300,
          license: "CC BY-SA 4.0",
        },
      },
    });
    const found = await new WikimediaImageProvider(wiki).find(artist("Yussef Dayes"));
    expect(found).toMatchObject({
      url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Yussef_Dayes.jpg",
      credit: "Photo: Wikimedia Commons, CC BY-SA 4.0",
      evidence: [
        'Q96362639: the only music act named "Yussef Dayes"',
        "enwiki summary Yussef Dayes.jpg",
      ],
    });
  });

  it.each([
    [
      "no P18 and no summary image",
      fakeWiki({
        search: { "Yussef Dayes": ["Q1"] },
        entities: { Q1: { label: "Yussef Dayes", enwiki: "Yussef Dayes" } },
      }),
      artist("Yussef Dayes"),
    ],
    [
      "a summary image hosted only on English Wikipedia (often non-free)",
      fakeWiki({
        search: { "Yussef Dayes": ["Q1"] },
        entities: { Q1: { label: "Yussef Dayes", enwiki: "Yussef Dayes" } },
        summaries: { "Yussef Dayes": "https://upload.wikimedia.org/wikipedia/en/1/12/Cover.jpg" },
      }),
      artist("Yussef Dayes"),
    ],
    [
      "a namesake who isn't a musician",
      fakeWiki({
        search: { "Alex Turner": ["Q1"] },
        entities: { Q1: { label: "Alex Turner", P106: ["Q82955"], P18: "A.jpg" } },
      }),
      artist("Alex Turner"),
    ],
    [
      "a file without a licence",
      fakeWiki({
        search: { "Alex Turner": ["Q1"] },
        entities: { Q1: { label: "Alex Turner", P18: "A.jpg" } },
        files: {
          "A.jpg": { url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg", width: 900 },
        },
      }),
      artist("Alex Turner"),
    ],
    ["nothing on Wikidata", fakeWiki({ entities: {} }), artist("Nitish Wadhwa")],
  ])("returns null for %s", async (_label, wiki, subject) => {
    expect(await new WikimediaImageProvider(wiki).find(subject)).toBeNull();
  });

  it("never looks up events", async () => {
    const wiki = shreyaWiki();
    const provider = new WikimediaImageProvider(wiki);
    expect(provider.supports({ kind: "event", title: "x", officialUrls: [] })).toBe(false);
    expect(await provider.find({ kind: "event", title: "x", officialUrls: [] })).toBeNull();
    expect(wiki.urls).toEqual([]);
  });

  it("searches the cleaned-up name too, but not the DJ toggle", async () => {
    const wiki = fakeWiki({ entities: {} });
    await new WikimediaImageProvider(wiki).find(artist("Dhyan Live"));
    const searched = wiki.urls.map((u) => new URL(u).searchParams.get("search")).filter(Boolean);
    expect(searched).toEqual(["Dhyan Live", "Dhyan"]);
  });

  it("also searches a duo's name without its joiner", async () => {
    const wiki = fakeWiki({
      search: { "Salim Sulaiman": ["Q3124942"] },
      entities: {
        Q3124942: { label: "Salim-Sulaiman", P31: ["Q215380"], P106: ["Q1415090"], P18: "S.jpg" },
      },
      files: {
        "S.jpg": {
          url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/S.jpg",
          width: 2000,
          license: "CC BY 3.0",
        },
      },
    });
    const found = await new WikimediaImageProvider(wiki).find(artist("Salim & Sulaiman"));
    const searched = wiki.urls.map((u) => new URL(u).searchParams.get("search")).filter(Boolean);
    expect(searched).toEqual(["Salim & Sulaiman", "Salim Sulaiman"]);
    expect(found?.evidence[0]).toBe('Q3124942: the only music act named "Salim & Sulaiman"');
  });

  it("only calls Wikimedia hosts", async () => {
    const wiki = shreyaWiki();
    await new WikimediaImageProvider(wiki).find(artist("Shreya Ghoshal", "0oOet2f43PA68X5RxKobEy"));
    expect(new Set(wiki.urls.map((u) => new URL(u).hostname))).toEqual(
      new Set(["www.wikidata.org", "commons.wikimedia.org"]),
    );
  });
});

describe("parseEntities", () => {
  it.each([
    ["not an object", "nope"],
    ["missing entities", {}],
    ["a missing (-1) entity", { entities: { "-1": { missing: "" } } }],
    ["an entity without labels", { entities: { Q1: { claims: {} } } }],
  ])("ignores %s", (_label, json) => {
    expect(parseEntities(json)).toEqual([]);
  });
});

describe("StoredSpotifyImageProvider", () => {
  it.each([
    ["https://i.scdn.co/image/x", "spotify"],
    [null, null],
  ])("%s → %s", async (spotifyImageUrl, source) => {
    const found = await new StoredSpotifyImageProvider().find({
      ...artist("A"),
      spotifyImageUrl,
    } as ImageSubject);
    expect(found?.source ?? null).toBe(source);
  });
});

describe("OfficialPosterProvider", () => {
  const reads: string[] = [];
  const reader = {
    read: async (url: string) => {
      reads.push(url);
      return url.includes("noimage")
        ? { status: "ok", image: null }
        : { status: "ok", image: "https://cdn.site/p.jpg" };
    },
  };

  it("uses the first allow-listed official page with an og:image", async () => {
    reads.length = 0;
    const found = await new OfficialPosterProvider(reader).find({
      kind: "event",
      title: "Sunburn",
      officialUrls: [
        "https://in.bookmyshow.com/x",
        "https://www.sunburn.in/noimage",
        "https://www.sunburn.in/event",
      ],
    });
    expect(reads).toEqual(["https://www.sunburn.in/noimage", "https://www.sunburn.in/event"]);
    expect(found).toMatchObject({
      url: "https://cdn.site/p.jpg",
      source: "official",
      credit: "Poster: sunburn.in",
    });
  });

  it("finds nothing without an official page", async () => {
    const found = await new OfficialPosterProvider(reader).find({
      kind: "event",
      title: "x",
      officialUrls: ["https://in.bookmyshow.com/x"],
    });
    expect(found).toBeNull();
  });
});

describe("HttpImageLinkChecker", () => {
  const checker = (status: number | Error, addresses = ["93.184.216.34"]) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: URL) => {
      calls.push(String(url));
      if (status instanceof Error) throw status;
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    return {
      calls,
      c: new HttpImageLinkChecker({ fetch: fetchImpl, resolve: async () => addresses }),
    };
  };

  it.each([
    [404, true],
    [410, true],
    [200, false],
    [301, false],
    [429, false],
    [503, false],
    [new Error("timeout"), false],
  ] as const)("HTTP %s → broken %s", async (status, broken) => {
    expect(await checker(status).c.isBroken("https://upload.wikimedia.org/x.jpg")).toBe(broken);
  });

  it.each([
    ["http://upload.wikimedia.org/x.jpg", true],
    ["not a url", true],
  ])("%s → broken %s without a request", async (url, broken) => {
    const { c, calls } = checker(200);
    expect(await c.isBroken(url)).toBe(broken);
    expect(calls).toEqual([]);
  });

  it("never requests a private address", async () => {
    const { c, calls } = checker(404, ["10.0.0.5"]);
    expect(await c.isBroken("https://intranet.example/x.jpg")).toBe(false);
    expect(calls).toEqual([]);
  });
});

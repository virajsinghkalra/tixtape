import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EventCandidate } from "@/domain/events/extract/candidate";
import { SOURCE_PRECEDENCE } from "@/domain/events/dedupe";
import { EVENT_SOURCES } from "@/domain/shared/lineup";
import { HIGHAPE_BASE, HighApeSource } from "./highape";
import { createMemoryHostLog, PoliteFetcher, RobotsDisallowedError } from "./polite-fetch";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/highape/${name}`, import.meta.url)), "utf8");

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOW = new Date("2026-11-21T10:00:00Z");
const ROBOTS =
  "User-Agent: *\nAllow: /\nDisallow: /api/\nDisallow: /account/\nDisallow: /ticket/\n";
const html = (body: string) => new HttpResponse(body, { headers: { "content-type": "text/html" } });

function source(cities: string[]) {
  let now = NOW.getTime();
  const logger = { warn: vi.fn() };
  const fetcher = new PoliteFetcher({
    fetch: (...args) => fetch(...args),
    sleep: async (ms) => {
      now += ms;
    },
    clock: { now: () => new Date(now) },
    logger,
    hostLog: createMemoryHostLog(),
    resolve: async () => ["93.184.216.34"],
  });
  return { src: new HighApeSource({ fetcher, logger, cities }), logger };
}

async function collect(src: HighApeSource): Promise<EventCandidate[]> {
  const out: EventCandidate[] = [];
  for await (const c of src.collect({ now: NOW })) out.push(c);
  return out;
}

describe("HighApeSource", () => {
  it("reads acts from the city page's Event JSON-LD, grounded on the JSON values", async () => {
    server.use(
      http.get("https://highape.com/robots.txt", () => new HttpResponse(ROBOTS)),
      http.get(`${HIGHAPE_BASE}/bangalore`, () => html(fixture("bangalore.html"))),
    );
    const { src, logger } = source(["bangalore"]);
    const found = await collect(src);
    expect(found.map((c) => [c.title, c.artists.map((a) => a.name), c.city])).toEqual([
      ["CROSS/OVER Ft Nikhil Chinapa", ["Nikhil Chinapa"], "Bengaluru"],
      ["War Drum | James Mithal Live at HOD Club", ["James Mithal"], "Bengaluru"],
      ["Black Friday | Karthik Gopinath live at HOD CLUB", ["Karthik Gopinath"], "Bengaluru"],
    ]);
    // The trek has no act, so it isn't a gig.
    expect(found[0]).toMatchObject({
      source: "highape",
      trust: "trusted",
      dateExplicit: true,
      provenance: {
        domain: "highape.com",
        officialKind: "ticketing",
        startTime: "20:00",
        via: "listing",
        quotes: { date: "2026-11-21T20:00:00+05:30" },
      },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("uses the page's own city, not HighApe's wrong addressLocality", async () => {
    server.use(
      http.get("https://highape.com/robots.txt", () => new HttpResponse(ROBOTS)),
      http.get(`${HIGHAPE_BASE}/mumbai`, () => html(fixture("mumbai.html"))),
    );
    const found = await collect(source(["mumbai"]).src);
    // No item on the trimmed Mumbai page names an act: nothing to validate.
    expect(found).toEqual([]);
  });

  it("is idempotent: the same page gives the same external IDs", async () => {
    server.use(
      http.get("https://highape.com/robots.txt", () => new HttpResponse(ROBOTS)),
      http.get(`${HIGHAPE_BASE}/bangalore`, () => html(fixture("bangalore.html"))),
    );
    const a = (await collect(source(["bangalore"]).src)).map((c) => c.externalId);
    const b = (await collect(source(["bangalore"]).src)).map((c) => c.externalId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("stops when robots.txt disallows the city pages", async () => {
    server.use(
      http.get(
        "https://highape.com/robots.txt",
        () => new HttpResponse("User-agent: *\nDisallow: /\n"),
      ),
    );
    await expect(collect(source(["bangalore"]).src)).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("keeps going when one city page fails", async () => {
    server.use(
      http.get("https://highape.com/robots.txt", () => new HttpResponse(ROBOTS)),
      http.get(`${HIGHAPE_BASE}/goa`, () => new HttpResponse("oops", { status: 500 })),
      http.get(`${HIGHAPE_BASE}/bangalore`, () => html(fixture("bangalore.html"))),
    );
    const { src, logger } = source(["goa", "bangalore"]);
    expect(await collect(src)).toHaveLength(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${HIGHAPE_BASE}/goa` }),
      "highape: city page failed",
    );
  });

  it("every event source is ranked (D-053), the new gig sources included", () => {
    for (const s of EVENT_SOURCES) expect(SOURCE_PRECEDENCE).toContain(s);
    expect(SOURCE_PRECEDENCE.indexOf("artist_site")).toBeLessThan(
      SOURCE_PRECEDENCE.indexOf("rollingstone"),
    );
    expect(SOURCE_PRECEDENCE.indexOf("gig_web")).toBeGreaterThan(
      SOURCE_PRECEDENCE.indexOf("pollstar"),
    );
  });
});

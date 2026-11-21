/**
 * D-070 regressions for the collector's network edge (these replace the PoCs in
 * tests/qa/security/security-review.test.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/errors";
import { isPublicAddress } from "./ip-guard";
import {
  BlockedAddressError,
  createMemoryHostLog,
  PoliteFetcher,
  type Resolve,
} from "./polite-fetch";
import { TEAM_INNOVATION_URL, TeamInnovationSource } from "./teaminnovation";
import { TicketmasterSource } from "./ticketmaster";

const clock = { now: () => new Date("2026-11-21T12:00:00Z") };
const PUBLIC: Resolve = async () => ["93.184.216.34"];

function fetcherWith(
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  resolve = PUBLIC,
) {
  return new PoliteFetcher({
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetchFn(String(input), init)) as typeof fetch,
    sleep: async () => {},
    clock,
    logger: { warn: vi.fn() },
    hostLog: createMemoryHostLog(),
    resolve,
  });
}

const html = (body: string | ReadableStream<Uint8Array>, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/html", ...(init.headers ?? {}) },
  });
const noRobots = (url: string) => url.endsWith("/robots.txt");

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.0.0.5", false],
    ["172.16.3.4", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:10.1.2.3", false],
    ["64:ff9b::a9fe:a9fe", false],
    ["not-an-ip", false],
    ["93.184.216.34", true],
    ["8.8.8.8", true],
    ["2606:4700:4700::1111", true],
    ["::ffff:8.8.8.8", true],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe("PoliteFetcher SSRF guard (D-070)", () => {
  it("refuses loopback, link-local and private hosts given as IP literals", async () => {
    const fetchFn = vi.fn(async () => html("metadata"));
    const f = fetcherWith(fetchFn);
    for (const target of [
      "http://127.0.0.1:5432/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/admin",
      "http://[::1]/",
    ]) {
      await expect(f.getText(target, { accept: "text/html" })).rejects.toBeInstanceOf(
        BlockedAddressError,
      );
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a public-looking name that resolves to a private address", async () => {
    const fetchFn = vi.fn(async () => html("x"));
    const f = fetcherWith(fetchFn, async () => ["93.184.216.34", "10.0.0.7"]);
    await expect(
      f.getText("https://evil.example/x", { accept: "text/html" }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("follows redirects by hand and re-checks every hop", async () => {
    const seen: Array<{ url: string; redirect?: RequestRedirect }> = [];
    const f = fetcherWith(
      async (url, init) => {
        if (noRobots(url)) return new Response("", { status: 404 });
        seen.push({ url, redirect: init?.redirect });
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      },
      async (host) => (host === "sunburn.in" ? ["93.184.216.34"] : ["169.254.169.254"]),
    );
    await expect(f.getText("https://sunburn.in/x", { accept: "text/html" })).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    expect(seen).toEqual([{ url: "https://sunburn.in/x", redirect: "manual" }]);
  });

  it("stops after 3 redirects", async () => {
    let n = 0;
    const f = fetcherWith(async (url) => {
      if (noRobots(url)) return new Response("", { status: 404 });
      n++;
      return new Response(null, { status: 301, headers: { location: `/hop-${n}` } });
    });
    await expect(f.getText("https://example.org/start", { accept: "text/html" })).rejects.toThrow(
      /more than 3 times/u,
    );
    expect(n).toBe(4);
  });

  it("a redirect to another path still gets the document", async () => {
    const f = fetcherWith(async (url) => {
      if (noRobots(url)) return new Response("", { status: 404 });
      if (url.endsWith("/old"))
        return new Response(null, { status: 301, headers: { location: "/new" } });
      return html("moved here");
    });
    expect(await f.getText("https://example.org/old", { accept: "text/html" })).toBe("moved here");
  });

  it("stops reading a body as soon as it passes 5 MB", async () => {
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 8) return controller.close();
        pulled++;
        controller.enqueue(new Uint8Array(1_000_000).fill(97));
      },
    });
    const f = fetcherWith(async (url) =>
      noRobots(url) ? new Response("", { status: 404 }) : html(big),
    );
    await expect(f.getText("https://example.org/", { accept: "text/html" })).rejects.toThrow(
      /too much data/u,
    );
    expect(pulled).toBeLessThan(8);
  });

  it("accepts only HTML, XML/RSS and JSON documents", async () => {
    for (const [type, ok] of [
      ["text/html; charset=utf-8", true],
      ["application/rss+xml", true],
      ["application/json", true],
      ["application/ld+json", true],
      ["image/png", false],
      ["application/octet-stream", false],
      ["text/plain", false],
      ["", false],
    ] as const) {
      const f = fetcherWith(async (url) =>
        noRobots(url)
          ? new Response("", { status: 404 })
          : new Response("body", { headers: type ? { "content-type": type } : {} }),
      );
      const result = f.getText("https://example.org/", { accept: "*/*" });
      if (ok) await expect(result).resolves.toBe("body");
      else await expect(result).rejects.toThrow(/not a document/u);
    }
  });
});

describe("Team Innovation links stay on the site (D-070)", () => {
  it("skips a card whose link points to another host, without fetching it", async () => {
    const page = `<main><section class="cardcontainer">
      <div class="upcards"><div class="txtcrd"><h2>Evil Fest 2026</h2><h6>Mumbai · 1 Day</h6>
      <p>13th February, 2027</p><a href="http://169.254.169.254/latest/meta-data/">View Details</a></div></div>
      </section></main>`;
    const requested: string[] = [];
    const logger = { warn: vi.fn() };
    const f = fetcherWith(async (url) => {
      requested.push(url);
      if (noRobots(url)) return new Response("", { status: 404 });
      return html(page);
    });
    const found = [];
    for await (const c of new TeamInnovationSource({ fetcher: f, logger }).collect({
      now: clock.now(),
    })) {
      found.push(c);
    }
    expect(found).toEqual([]);
    expect(requested).toEqual(["https://teaminnovation.in/robots.txt", TEAM_INNOVATION_URL]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://169.254.169.254/latest/meta-data/" }),
      "teaminnovation: skipped a card linking to another host",
    );
  });
});

describe("Ticketmaster timeout (D-070)", () => {
  it("gives every page request an abort signal (10 s), so a stalled API can't hang a run", async () => {
    const fetchFn = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("down", { status: 503 }),
    );
    const tm = new TicketmasterSource({
      apiKey: "k",
      countryCodes: ["IN"],
      fetch: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
      clock,
      logger: { warn: vi.fn() },
    });
    await expect(
      (async () => {
        for await (const _ of tm.fetch({ from: clock.now() })) void _;
      })(),
    ).rejects.toBeInstanceOf(UpstreamError);
    const signal = fetchFn.mock.calls[0]![1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });
});

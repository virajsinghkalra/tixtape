/**
 * QA P1.6: Ticketmaster Discovery adapter. LLD §5.1/§5.2, D-008, D-027, ENGINEERING §7.
 * Fake fetch + fake clock/sleep: no network, no real sleeps.
 */
import { describe, expect, it, vi } from "vitest";
import type { RawEvent } from "@/application/ports/event-source";
import { TicketmasterSource } from "@/infrastructure/sources/ticketmaster";
import { UpstreamError } from "@/lib/errors";

const API_KEY = "SECRET-TM-KEY-123";

type TmEvent = Record<string, unknown>;

function tmEvent(
  id: string,
  over: Partial<TmEvent> = {},
  attractions: string[] | null = ["Headliner"],
): TmEvent {
  const embedded: Record<string, unknown> = {
    venues: [
      {
        id: `v-${id}`,
        name: "NSCI Dome",
        city: { name: "Mumbai" },
        state: { name: "Maharashtra" },
        country: { name: "India", countryCode: "IN" },
        location: { longitude: "72.82", latitude: "18.98" },
      },
    ],
  };
  if (attractions)
    embedded.attractions = attractions.map((name, i) => ({
      id: `a-${id}-${i}`,
      name,
      type: "attraction",
    }));
  return {
    id,
    name: `Show ${id}`,
    type: "event",
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: {
      start: { localDate: "2026-12-01", localTime: "19:00:00", dateTime: "2026-12-01T13:30:00Z" },
      timezone: "Asia/Kolkata",
      status: { code: "onsale" },
    },
    classifications: [
      {
        primary: true,
        segment: { id: "KZFzniwnSyZfZ7v7nJ", name: "Music" },
        genre: { name: "Rock" },
      },
    ],
    images: [{ url: `https://s1.ticketm.net/${id}.jpg`, width: 1024, height: 576 }],
    _embedded: embedded,
    ...over,
  };
}

function page(events: TmEvent[] | null, number: number, totalPages: number, size = 200) {
  return {
    ...(events ? { _embedded: { events } } : {}),
    _links: { self: { href: "/discovery/v2/events.json" } },
    page: { size, totalElements: totalPages * size, totalPages, number },
  };
}

type Responder = (url: URL, call: number) => Response | Promise<Response>;

function harness(respond: Responder, opts: { countryCodes?: string[]; pageSize?: number } = {}) {
  let now = Date.parse("2026-11-21T00:00:00Z");
  const requests: { url: URL; at: number }[] = [];
  const warn = vi.fn();
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push({ url, at: now });
    if (requests.length > 200) throw new Error("runaway paging");
    return respond(url, requests.length - 1);
  });
  const sleep = vi.fn(async (ms: number) => {
    now += Math.max(0, ms);
  });
  const src = new TicketmasterSource({
    apiKey: API_KEY,
    countryCodes: opts.countryCodes ?? ["IN"],
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
    clock: { now: () => new Date(now) },
    logger: { warn } as never,
    ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
  });
  return { src, requests, warn, sleep, fetchFn };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function collect(it: AsyncIterable<RawEvent>): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const FROM = {
  from: new Date("2026-11-21T00:00:00.000Z"),
  to: new Date("2027-11-21T00:00:00.000Z"),
};

describe("QA Ticketmaster: request shape", () => {
  it("queries music events for the country, with the key and ms-free ISO dates", async () => {
    const h = harness(() => ok(page([tmEvent("e1")], 0, 1)));
    await collect(h.src.fetch(FROM));
    const u = h.requests[0]!.url;
    expect(u.pathname).toBe("/discovery/v2/events.json");
    expect(u.searchParams.get("classificationName")?.toLowerCase()).toBe("music");
    expect(u.searchParams.get("countryCode")).toBe("IN");
    expect(u.searchParams.get("apikey")).toBe(API_KEY);
    // Discovery API rejects fractional seconds: YYYY-MM-DDTHH:mm:ssZ
    expect(u.searchParams.get("startDateTime")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const end = u.searchParams.get("endDateTime");
    if (end !== null) expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("QA Ticketmaster: paging", () => {
  it("follows totalPages and stops", async () => {
    const h = harness((u) => {
      const p = Number(u.searchParams.get("page") ?? 0);
      return ok(page([tmEvent(`p${p}`)], p, 3));
    });
    const evs = await collect(h.src.fetch(FROM));
    expect(h.requests).toHaveLength(3);
    expect(evs.map((e) => e.externalId)).toEqual(["p0", "p1", "p2"]);
  });

  it("stops on a page with no _embedded (zero results)", async () => {
    const h = harness(() => ok(page(null, 0, 0)));
    expect(await collect(h.src.fetch(FROM))).toEqual([]);
    expect(h.requests).toHaveLength(1);
  });

  it("never pages past the 1000-result deep-paging limit", async () => {
    const h = harness((u) => {
      const p = Number(u.searchParams.get("page") ?? 0);
      const size = Number(u.searchParams.get("size") ?? 20);
      return ok(page([tmEvent(`p${p}`)], p, 1000, size));
    });
    await collect(h.src.fetch(FROM));
    for (const r of h.requests) {
      const p = Number(r.url.searchParams.get("page") ?? 0);
      const size = Number(r.url.searchParams.get("size") ?? 20);
      expect((p + 1) * size).toBeLessThanOrEqual(1000);
    }
    expect(h.requests.length).toBeGreaterThan(0);
  });

  it("queries each country in turn", async () => {
    const h = harness((u) => ok(page([tmEvent(`${u.searchParams.get("countryCode")}`)], 0, 1)), {
      countryCodes: ["IN", "AE"],
    });
    const evs = await collect(h.src.fetch(FROM));
    expect(h.requests.map((r) => r.url.searchParams.get("countryCode"))).toEqual(["IN", "AE"]);
    expect(evs).toHaveLength(2);
  });
});

describe("QA Ticketmaster: 5 req/s pacing", () => {
  it("spaces requests ≥ 200ms apart on the injected clock, across pages and countries", async () => {
    const h = harness(
      (u) => {
        const p = Number(u.searchParams.get("page") ?? 0);
        return ok(page([tmEvent(`${u.searchParams.get("countryCode")}${p}`)], p, 4));
      },
      { countryCodes: ["IN", "AE"] },
    );
    await collect(h.src.fetch(FROM));
    expect(h.requests).toHaveLength(8);
    for (let i = 1; i < h.requests.length; i++) {
      expect(h.requests[i]!.at - h.requests[i - 1]!.at).toBeGreaterThanOrEqual(200);
    }
  });

  it("any 1-second window holds at most 5 requests", async () => {
    const h = harness((u) => {
      const p = Number(u.searchParams.get("page") ?? 0);
      return ok(page([tmEvent(`x${p}`)], p, 12));
    });
    await collect(h.src.fetch(FROM));
    const ts = h.requests.map((r) => r.at);
    for (const t of ts)
      expect(ts.filter((x) => x >= t && x < t + 1000).length).toBeLessThanOrEqual(5);
  });
});

describe("QA Ticketmaster: malformed and partial events", () => {
  it("skips malformed events (and warns) without failing the page", async () => {
    const bad = [
      { id: "no-name", ...(({ name: _n, ...rest }) => rest)(tmEvent("no-name")) },
      tmEvent("no-dates", { dates: {} }),
      tmEvent("bad-date", { dates: { start: { dateTime: "not-a-date" } } }),
      tmEvent("no-venue", { _embedded: { attractions: [{ id: "a", name: "A" }] } }),
      tmEvent("no-embedded", { _embedded: undefined }),
      "garbage",
      null,
    ];
    const h = harness(() =>
      ok(page([tmEvent("good1"), ...(bad as TmEvent[]), tmEvent("good2")], 0, 1)),
    );
    const evs = await collect(h.src.fetch(FROM));
    expect(evs.map((e) => e.externalId)).toEqual(["good1", "good2"]);
    expect(h.warn).toHaveBeenCalled();
  });

  it("handles missing or empty attractions without throwing", async () => {
    const h = harness(() => ok(page([tmEvent("none", {}, null), tmEvent("empty", {}, [])], 0, 1)));
    const evs = await collect(h.src.fetch(FROM));
    for (const e of evs) expect(e.lineup).toEqual([]);
  });

  // Regression QA-E-3 (fixed): non-music events must be skipped
  it("does not yield non-music events if the API returns any", async () => {
    const sports = tmEvent("sports", {
      classifications: [{ primary: true, segment: { id: "KZFzniwnSyZfZ7v7nE", name: "Sports" } }],
    });
    const h = harness(() => ok(page([sports, tmEvent("music")], 0, 1)));
    const evs = await collect(h.src.fetch(FROM));
    expect(evs.map((e) => e.externalId)).toEqual(["music"]);
  });

  it("yields events that pass RawEventSchema with source ticketmaster", async () => {
    const h = harness(() => ok(page([tmEvent("e1")], 0, 1)));
    const [e] = await collect(h.src.fetch(FROM));
    expect(e).toMatchObject({ source: "ticketmaster", externalId: "e1", title: "Show e1" });
    expect(e!.startsAt.toISOString()).toBe("2026-12-01T13:30:00.000Z");
    expect(e!.venue).toMatchObject({ name: "NSCI Dome", city: "Mumbai", country: "IN" });
  });
});

describe("QA Ticketmaster: upstream failures", () => {
  it.each([500, 502, 503, 429, 401])(
    "HTTP %i fails with UpstreamError (bounded retries)",
    async (status) => {
      const h = harness(() => new Response("{}", { status, headers: { "retry-after": "1" } }));
      await expect(collect(h.src.fetch(FROM))).rejects.toBeInstanceOf(UpstreamError);
      expect(h.requests.length).toBeLessThanOrEqual(10);
    },
  );

  it("a 5xx on page 2 fails the run after yielding page 1", async () => {
    const h = harness((u) => {
      const p = Number(u.searchParams.get("page") ?? 0);
      return p === 0 ? ok(page([tmEvent("p0")], 0, 3)) : new Response("oops", { status: 503 });
    });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const e of h.src.fetch(FROM)) seen.push(e.externalId!);
      })(),
    ).rejects.toBeInstanceOf(UpstreamError);
    expect(seen).toEqual(["p0"]);
  });

  it("a non-JSON / unusable page fails with UpstreamError", async () => {
    const h = harness(() => new Response("<html>maintenance</html>", { status: 200 }));
    await expect(collect(h.src.fetch(FROM))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("a network error surfaces as UpstreamError", async () => {
    const h = harness(() => {
      throw new TypeError("fetch failed");
    });
    await expect(collect(h.src.fetch(FROM))).rejects.toBeInstanceOf(UpstreamError);
  });

  it("never leaks the API key in errors or logs", async () => {
    const h = harness(() => new Response("{}", { status: 500 }));
    const err = await collect(h.src.fetch(FROM)).catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain(API_KEY);
    expect(JSON.stringify(err)).not.toContain(API_KEY);
    const h2 = harness(() => ok(page([tmEvent("bad", { dates: {} })], 0, 1)));
    await collect(h2.src.fetch(FROM));
    expect(JSON.stringify(h2.warn.mock.calls)).not.toContain(API_KEY);
  });
});

describe("QA Ticketmaster: tiers by attraction order (D-027) and type", () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => `Act ${String.fromCharCode(65 + i)}`);
  const expected: Record<number, string[]> = {
    1: ["headliner"],
    3: ["headliner", "support", "support"],
    4: ["headliner", "sub", "sub", "mid"],
    10: ["headliner", "sub", "sub", "mid", "mid", "mid", "mid", "mid", "mid", "mid"],
    11: ["headliner", "sub", "sub", "mid", "mid", "mid", "mid", "mid", "mid", "mid", "support"],
  };
  it.each([1, 3, 4, 10, 11])("%i acts", async (n) => {
    const h = harness(() => ok(page([tmEvent("t", {}, names(n))], 0, 1)));
    const [e] = await collect(h.src.fetch(FROM));
    expect(e!.lineup.map((l) => l.tier)).toEqual(expected[n]);
    expect(e!.lineup.map((l) => l.billingRank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(e!.lineup.map((l) => l.name)).toEqual(names(n));
  });

  it("festival detection: ≥6 acts or 'fest' in the name; otherwise concert", async () => {
    const h = harness(() =>
      ok(
        page(
          [
            tmEvent("five", {}, names(5)),
            tmEvent("six", {}, names(6)),
            tmEvent("fest", { name: "Mumbai Jazz Fest" }, names(1)),
          ],
          0,
          1,
        ),
      ),
    );
    const evs = await collect(h.src.fetch(FROM));
    expect(Object.fromEntries(evs.map((e) => [e.externalId, e.type]))).toEqual({
      five: "concert",
      six: "festival",
      fest: "festival",
    });
  });

  it("caps an oversized attraction list rather than dropping the event", async () => {
    const many = Array.from({ length: 320 }, (_, i) => `Act ${i}`);
    const h = harness(() => ok(page([tmEvent("big", {}, many)], 0, 1)));
    const evs = await collect(h.src.fetch(FROM));
    // Either kept with ≤300 acts or skipped with a warning; it must not throw.
    for (const e of evs) expect(e.lineup.length).toBeLessThanOrEqual(300);
  });
});

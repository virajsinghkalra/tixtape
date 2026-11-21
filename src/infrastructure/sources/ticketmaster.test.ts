import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RawEvent } from "@/domain/events/raw-event";
import { UpstreamError } from "@/lib/errors";
import page0 from "./fixtures/ticketmaster-events-page0.json";
import page1 from "./fixtures/ticketmaster-events-page1.json";
import { TicketmasterSource, type TicketmasterDeps } from "./ticketmaster";

const ENDPOINT = "https://app.ticketmaster.com/discovery/v2/events.json";
const API_KEY = "test-key-123";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** A clock that only moves when the adapter sleeps, so pacing is observable without real time. */
function fakeTime(start = Date.parse("2026-01-01T00:00:00Z")) {
  let now = start;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  return { clock: { now: () => new Date(now) }, sleep, advance: (ms: number) => (now += ms) };
}

function source(overrides: Partial<TicketmasterDeps> = {}) {
  const time = fakeTime();
  const logger = { warn: vi.fn() };
  const deps: TicketmasterDeps = {
    apiKey: API_KEY,
    countryCodes: ["IN"],
    fetch: (...args) => fetch(...args),
    sleep: time.sleep,
    clock: time.clock,
    logger,
    pageSize: 5,
    ...overrides,
  };
  return { adapter: new TicketmasterSource(deps), time, logger };
}

async function collect(iter: AsyncIterable<RawEvent>): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const from = new Date("2026-01-01T00:00:00.000Z");

function servePages(pages: unknown[], seen: URL[] = []) {
  server.use(
    http.get(ENDPOINT, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const page = pages[Number(url.searchParams.get("page"))];
      return page
        ? HttpResponse.json(page)
        : HttpResponse.json({ error: "no page" }, { status: 400 });
    }),
  );
  return seen;
}

describe("TicketmasterSource", () => {
  it("sends the documented query parameters", async () => {
    const seen = servePages([page0, page1]);
    const { adapter } = source();
    await collect(adapter.fetch({ from, to: new Date("2026-12-31T23:59:59.500Z") }));
    expect(Object.fromEntries(seen[0]!.searchParams)).toEqual({
      apikey: API_KEY,
      classificationName: "music",
      countryCode: "IN",
      startDateTime: "2026-01-01T00:00:00Z",
      endDateTime: "2026-12-31T23:59:59Z",
      sort: "date,asc",
      size: "5",
      page: "0",
    });
    expect(seen.map((u) => u.searchParams.get("page"))).toEqual(["0", "1"]);
  });

  it("maps events: performers in order with tiers, venue, dates, image and genre", async () => {
    servePages([page0, page1]);
    const { adapter } = source();
    const [lolla, kuhad, divine] = await collect(adapter.fetch({ from }));

    expect(lolla).toMatchObject({
      source: "ticketmaster",
      externalId: "Z7r9jZ1A7fF8k",
      url: "https://www.ticketmaster.com/lollapalooza-india-2026/event/Z7r9jZ1A7fF8k",
      title: "Lollapalooza India 2026 - 2 Day Pass",
      type: "festival",
      startsAt: new Date("2026-03-07T08:30:00Z"),
      endsAt: new Date("2026-03-08T16:30:00Z"),
      status: "announced",
      genre: "Rock",
      imageUrl: "https://s1.ticketm.net/dam/a/lolla_RETINA_LANDSCAPE_16_9.jpg",
      venue: {
        name: "Mahalakshmi Race Course",
        city: "Mumbai",
        state: "MH",
        country: "IN",
        lat: 18.9827,
        lng: 72.8205,
      },
    });
    expect(lolla!.lineup).toEqual([
      { name: "Linkin Park", billingRank: 1, tier: "headliner" },
      { name: "Glass Animals", billingRank: 2, tier: "sub" },
      { name: "Green Day", billingRank: 3, tier: "sub" },
      { name: "Anuv Jain", billingRank: 4, tier: "mid" },
      { name: "Nucleya b2b Ritviz", billingRank: 5, tier: "mid" },
    ]);

    // No dateTime: local 19:30 in Asia/Kolkata is 14:00 UTC. Unnamed attraction dropped.
    expect(kuhad).toMatchObject({
      type: "concert",
      startsAt: new Date("2026-03-14T14:00:00Z"),
      genre: undefined,
      imageUrl: "https://s1.ticketm.net/dam/a/kuhad_3_2.jpg",
      venue: { city: "Bangalore", state: "Karnataka" },
    });
    expect(kuhad!.venue.lat).toBeUndefined();
    expect(kuhad!.lineup).toEqual([
      { name: "Prateek Kuhad", billingRank: 1, tier: "headliner" },
      { name: "When Chai Met Toast", billingRank: 2, tier: "support" },
    ]);

    // Cancelled status; unparseable coordinates are dropped, not guessed.
    expect(divine).toMatchObject({
      status: "cancelled",
      genre: "Hip-Hop/Rap",
      venue: { city: "New Delhi" },
    });
    expect(divine!.venue.lat).toBeUndefined();
  });

  it("skips malformed events with a warning and keeps going", async () => {
    servePages([page0, page1]);
    const { adapter, logger } = source();
    const events = await collect(adapter.fetch({ from }));
    expect(events.map((e) => e.externalId)).toEqual([
      "Z7r9jZ1A7fF8k",
      "G5diZ9kQb3e0X",
      "G5diZ9cDivine",
    ]);
    const skipped = logger.warn.mock.calls.map(
      ([ctx]) => (ctx as { externalId: string }).externalId,
    );
    expect(skipped).toEqual(["G5noVenue0001", "G5noName00001", "G5noDate00001"]);
  });

  it("skips non-music events at debug level (LLD §5.1)", async () => {
    const sports = {
      ...page1._embedded.events[0],
      id: "G5sports",
      classifications: [{ segment: { name: "Sports" }, genre: { name: "Cricket" } }],
    };
    servePages([
      {
        ...page1,
        _embedded: { events: [sports, page1._embedded.events[0]] },
        page: { ...page1.page, totalPages: 1 },
      },
    ]);
    const debug = vi.fn();
    const { adapter, logger } = source({ logger: { warn: vi.fn(), debug } });
    const events = await collect(adapter.fetch({ from }));
    expect(events.map((e) => e.externalId)).toEqual(["G5diZ9cDivine"]);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "G5sports" }),
      "ticketmaster: skipped non-music event",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("drops non-http(s) links and images instead of passing them on (QA-E-1)", async () => {
    const event = {
      ...page1._embedded.events[0],
      url: "javascript:alert(1)",
      images: [
        { url: "data:image/png;base64,AAAA", width: 4000, ratio: "16_9" },
        { url: "https://s1.ticketm.net/ok.jpg", width: 100, ratio: "3_2" },
      ],
    };
    servePages([
      { ...page1, _embedded: { events: [event] }, page: { ...page1.page, totalPages: 1 } },
    ]);
    const [e] = await collect(source().adapter.fetch({ from }));
    expect(e).toMatchObject({ url: undefined, imageUrl: "https://s1.ticketm.net/ok.jpg" });
  });

  it.each([
    ["no zone anywhere, India → 00:00 IST", undefined, undefined, "IN", "2026-05-01T18:30:00.000Z"],
    ["venue zone wins", "Asia/Dubai", "Asia/Kolkata", "AE", "2026-05-01T20:00:00.000Z"],
    [
      "event zone when the venue has none",
      undefined,
      "Asia/Kolkata",
      "AE",
      "2026-05-01T18:30:00.000Z",
    ],
    ["other country without zones → UTC", undefined, undefined, "AE", "2026-05-02T00:00:00.000Z"],
  ])("date-only start: %s", async (_label, venueZone, eventZone, country, expected) => {
    const base = page1._embedded.events[0]!;
    const event = {
      ...base,
      dates: { start: { localDate: "2026-05-02" }, timezone: eventZone },
      _embedded: {
        ...base._embedded,
        venues: [
          { ...base._embedded.venues[0], timezone: venueZone, country: { countryCode: country } },
        ],
      },
    };
    servePages([
      { ...page1, _embedded: { events: [event] }, page: { ...page1.page, totalPages: 1 } },
    ]);
    const [e] = await collect(source().adapter.fetch({ from }));
    expect(e!.startsAt.toISOString()).toBe(expected);
    expect(e!.startsAtDateOnly).toBe(true);
  });

  it.each([
    [
      "UTC dateTime",
      { localDate: "2026-05-02", localTime: "19:30:00", dateTime: "2026-05-02T14:00:00Z" },
      false,
      "2026-05-02T14:00:00.000Z",
    ],
    [
      "local time only",
      { localDate: "2026-05-02", localTime: "19:30:00" },
      false,
      "2026-05-02T14:00:00.000Z",
    ],
    ["date only", { localDate: "2026-05-02" }, true, "2026-05-01T18:30:00.000Z"],
    [
      "timeTBA with a placeholder dateTime",
      { localDate: "2026-05-02", dateTime: "2026-05-02T06:29:00Z", timeTBA: true },
      true,
      "2026-05-01T18:30:00.000Z",
    ],
    [
      "noSpecificTime",
      { localDate: "2026-05-02", localTime: "00:00:00", noSpecificTime: true },
      true,
      "2026-05-01T18:30:00.000Z",
    ],
  ])("startsAtDateOnly (D-034): %s → %s", async (_label, start, dateOnly, iso) => {
    const base = page1._embedded.events[0]!;
    const event = { ...base, dates: { start, timezone: "Asia/Kolkata" } };
    servePages([
      { ...page1, _embedded: { events: [event] }, page: { ...page1.page, totalPages: 1 } },
    ]);
    const [e] = await collect(source().adapter.fetch({ from }));
    expect(e).toMatchObject({ startsAtDateOnly: dateOnly });
    expect(e!.startsAt.toISOString()).toBe(iso);
  });

  it("paces requests to at most 5 per second without real sleeps", async () => {
    servePages([page0, page1]);
    const { adapter, time } = source({ countryCodes: ["IN", "AE"] });
    await collect(adapter.fetch({ from }));
    // 4 requests (2 pages × 2 countries): no wait before the first, 200 ms before the rest.
    expect(time.sleep.mock.calls).toEqual([[200], [200], [200]]);
  });

  it("doesn't sleep when enough time has already passed", async () => {
    servePages([page0, page1]);
    const { adapter, time } = source();
    const iter = adapter.fetch({ from })[Symbol.asyncIterator]();
    await iter.next(); // first page fetched
    time.advance(500);
    while (!(await iter.next()).done);
    expect(time.sleep).not.toHaveBeenCalled();
  });

  it("queries each country in turn", async () => {
    const seen = servePages([{ ...page1, page: { ...page1.page, totalPages: 1 } }]);
    const { adapter } = source({ countryCodes: ["IN", "AE"] });
    expect(await collect(adapter.fetch({ from }))).toHaveLength(2);
    expect(seen.map((u) => u.searchParams.get("countryCode"))).toEqual(["IN", "AE"]);
  });

  it("handles an empty result without _embedded", async () => {
    servePages([{ page: { size: 200, totalElements: 0, totalPages: 0, number: 0 } }]);
    const { adapter } = source();
    expect(await collect(adapter.fetch({ from }))).toEqual([]);
  });

  it("stops at Ticketmaster's 1000-result paging window and warns", async () => {
    const empty = (n: number) => ({
      page: { size: 200, totalElements: 5000, totalPages: 25, number: n },
    });
    const seen = servePages(Array.from({ length: 25 }, (_, n) => empty(n)));
    const { adapter, logger } = source({ pageSize: 500 });
    await collect(adapter.fetch({ from }));
    // Page size is capped at 200, so pages 0–4 cover the first 1000 results.
    expect(seen.map((u) => u.searchParams.get("size"))).toEqual([
      "200",
      "200",
      "200",
      "200",
      "200",
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ totalElements: 5000 }),
      expect.stringContaining("capped at 1000"),
    );
  });

  it.each([
    ["HTTP 500", () => HttpResponse.json({ fault: "boom" }, { status: 500 }), /HTTP 500/],
    ["HTTP 429", () => HttpResponse.json({ fault: "quota" }, { status: 429 }), /HTTP 429/],
    [
      "a page without paging info",
      () => HttpResponse.json({ _embedded: { events: [] } }),
      /unexpected shape/,
    ],
    ["a non-JSON body", () => new HttpResponse("<html>", { status: 200 }), /unexpected shape/],
    ["a network error", () => HttpResponse.error(), /could not be reached/],
  ])(
    "throws UpstreamError on %s, without leaking the API key",
    async (_label, respond, message) => {
      server.use(http.get(ENDPOINT, respond));
      const { adapter } = source();
      const error = await collect(adapter.fetch({ from })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as Error).message).toMatch(message);
      expect((error as Error).message).not.toContain(API_KEY);
    },
  );
});

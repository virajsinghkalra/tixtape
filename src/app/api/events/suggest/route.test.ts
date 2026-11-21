import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsUseCases } from "@/application/events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";

const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/events", () => ({ events: () => wired.current }));

const { GET } = await import("./route");

const listing = {
  id: "e1",
  title: "Sunburn Arena",
  type: "concert" as const,
  startsAt: new Date("2026-12-28T14:00:00Z"),
  startsAtDateOnly: false,
  city: "Goa",
  venueName: "Vagator Beach",
};

beforeEach(() => {
  const world = fakeEventsWorld(new Date("2026-11-21T00:00:00Z"));
  world.search.candidates.events = [
    {
      ...listing,
      venueNormalizedName: "vagator beach",
      titleSimilarity: 0.57,
      venueSimilarity: 0,
      trendScore: 0,
      trendUpdatedAt: new Date("2026-11-21T00:00:00Z"),
      artist: null,
    },
  ];
  world.search.recommendations = {
    trending: [listing],
    upNext: [],
    thisWeekend: [],
    nearYou: [],
    popularSearches: ["lolla"],
  };
  wired.current = createEventsUseCases({
    ...world,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
});

const get = (qs: string) => GET(new Request(`http://x/api/events/suggest${qs}`), undefined);

describe("GET /api/events/suggest", () => {
  it("typed: returns the documented groups (results stay backward-compatible)", async () => {
    const res = await get("?q=sunbrn");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        {
          id: "e1",
          title: "Sunburn Arena",
          type: "concert",
          startsAt: "2026-12-28T14:00:00.000Z",
          startsAtDateOnly: false,
          city: "Goa",
          venueName: "Vagator Beach",
          matchReason: "fuzzy",
          matchedText: "Sunburn",
        },
      ],
      artists: [],
      cities: [],
      filters: {},
    });
  });

  it("echoes understood filters with ISO dates", async () => {
    const body = await (await get("?q=december")).json();
    expect(body.filters).toEqual({
      from: "2026-11-30T18:30:00.000Z",
      to: "2026-12-31T18:29:59.999Z",
    });
  });

  it.each(["", "?q=", "?q=%20%20"])("empty query %j returns sections", async (qs) => {
    const body = await (await get(qs)).json();
    expect(body.sections.map((s: { id: string }) => s.id)).toEqual([
      "trending",
      "popular_searches",
    ]);
    expect(body.sections[0].items[0]).toMatchObject({
      id: "e1",
      matchReason: "title",
      matchedText: "",
    });
  });

  it.each(["?q=s", "?q=%25", `?q=${"a".repeat(101)}`, "?q=sun&extra=1", "?city="])(
    "400s %s",
    async (qs) => {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("validation_failed");
    },
  );
});

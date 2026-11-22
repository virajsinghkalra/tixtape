import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsUseCases } from "@/application/events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";
import type * as ServerEvents from "@/server/events";

const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/events", async (importOriginal) => ({
  ...(await importOriginal<typeof ServerEvents>()),
  events: () => wired.current,
}));

const { GET } = await import("./route");

let world: ReturnType<typeof fakeEventsWorld>;

beforeEach(async () => {
  world = fakeEventsWorld(new Date("2026-11-21T00:00:00Z"));
  const useCases = createEventsUseCases({
    ...world,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  wired.current = useCases;
  await useCases.createAdminEvent({
    title: "NH7 Weekender",
    type: "festival",
    status: "announced",
    startsAt: new Date("2026-12-12T10:00:00Z"),
    endsAt: null,
    genre: null,
    imageUrl: null,
    url: null,
    venue: { name: "Lawns", city: "Pune", country: "IN" },
    lineup: [{ name: "The Local Train", tier: "headliner", billingRank: 1 }],
    visibility: "published",
    posterUrl: "https://example.org/poster.jpg",
  });
});

describe("GET /api/search", () => {
  it("returns the paginated page shape", async () => {
    const res = await GET(new Request("http://x/api/search?q=lolla&page=1&pageSize=10"), undefined);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      results: [],
      artists: [],
      cities: [],
      filters: {},
      total: 0,
      page: 1,
      pageSize: 10,
    });
    expect(world.searchLog.searches.map((s) => s.query)).toEqual(["lolla"]);
  });

  it.each(["", "?pageSize=51&q=lolla", "?q=lolla&foo=1", "?type=party"])("400s %j", async (qs) => {
    const res = await GET(new Request(`http://x/api/search${qs}`), undefined);
    expect(res.status).toBe(400);
  });
});

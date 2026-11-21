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
const { POST: click } = await import("./click/route");
const { POST: view } = await import("../events/[id]/view/route");

let world: ReturnType<typeof fakeEventsWorld>;
let eventId: string;

beforeEach(async () => {
  world = fakeEventsWorld(new Date("2026-11-21T00:00:00Z"));
  const useCases = createEventsUseCases({
    ...world,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  wired.current = useCases;
  const { event } = await useCases.createAdminEvent({
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
  });
  eventId = event.id;
});

type Handler = (req: Request, ctx: never) => Promise<Response>;
const post = (handler: Handler, url: string, body?: unknown, ip = "203.0.113.7", ctx?: unknown) =>
  handler(
    new Request(url, {
      method: "POST",
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ctx as never,
  );

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

describe("POST /api/search/click and /api/events/:id/view", () => {
  it("click: 204, bumps the event and logs the query, keyed by the first forwarded IP", async () => {
    const res = await post(click, "http://x/api/search/click", { q: "nh 7", eventId });
    expect(res.status).toBe(204);
    expect(world.engagement.recorded.map((r) => r.kind)).toEqual(["search_click"]);
    expect(world.searchLog.clicks.map((c) => c.query)).toEqual(["nh 7"]);
  });

  it("view: 204, then repeats from the same client aren't counted", async () => {
    const ctx = { params: Promise.resolve({ id: eventId }) };
    expect((await post(view, "http://x", undefined, "1.1.1.1", ctx)).status).toBe(204);
    expect(
      (
        await post(view, "http://x", undefined, "1.1.1.1", {
          params: Promise.resolve({ id: eventId }),
        })
      ).status,
    ).toBe(204);
    expect(world.engagement.recorded).toHaveLength(1);
  });

  it.each([
    ["unknown event", { q: "x", eventId: "00000000-0000-4000-8000-000000000000" }, 404],
    ["bad body", { q: "x", eventId: "nope" }, 400],
    ["extra key", { eventId: "00000000-0000-4000-8000-000000000000", ip: "1.2.3.4" }, 400],
  ])("click: %s → %i", async (_label, body, status) => {
    expect((await post(click, "http://x", body)).status).toBe(status);
  });

  it.each(["held", "archived"] as const)(
    "a %s event answers exactly like a missing one (QA-E-5/6)",
    async (visibility) => {
      await world.events.setVisibility(eventId as never, visibility);
      const missing = "00000000-0000-4000-8000-000000000000";
      const viewOf = (id: string) =>
        post(view, "http://x", undefined, "4.4.4.4", { params: Promise.resolve({ id }) });
      const clickOf = (id: string) => post(click, "http://x", { q: "nh7", eventId: id }, "4.4.4.4");
      for (const call of [viewOf, clickOf]) {
        const [hidden, again, gone] = [
          await call(eventId),
          await call(eventId),
          await call(missing),
        ];
        expect([hidden.status, again.status, gone.status]).toEqual([404, 404, 404]);
        expect(await hidden.json()).toEqual(await gone.json());
      }
    },
  );

  it("view: a malformed id is 404", async () => {
    const res = await post(view, "http://x", undefined, "1.1.1.1", {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("429s a client over its limit", async () => {
    for (let i = 0; i < 60; i++) {
      await post(view, "http://x", undefined, "9.9.9.9", {
        params: Promise.resolve({ id: eventId }),
      });
    }
    const res = await post(view, "http://x", undefined, "9.9.9.9", {
      params: Promise.resolve({ id: eventId }),
    });
    expect(res.status).toBe(429);
  });
});

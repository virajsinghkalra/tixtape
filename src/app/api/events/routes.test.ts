import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEventsUseCases,
  ListEventsQuerySchema,
  type EventsUseCases,
} from "@/application/events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";

const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/events", () => ({ events: () => wired.current }));

const { GET: list } = await import("./route");
const { GET: getOne } = await import("./[id]/route");

let useCases: EventsUseCases;
let world: ReturnType<typeof fakeEventsWorld>;
beforeEach(async () => {
  world = fakeEventsWorld();
  useCases = createEventsUseCases({
    ...world,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  wired.current = useCases;
  await useCases.createAdminEvent({
    title: "NH7 Weekender",
    type: "festival",
    status: "full_lineup",
    startsAt: new Date("2026-12-05T10:00:00Z"),
    endsAt: null,
    genre: null,
    imageUrl: null,
    url: null,
    venue: { name: "Mahalakshmi Lawns", city: "Poona", country: "IN" },
    lineup: [{ name: "The Local Train", tier: "headliner", billingRank: 1 }],
    visibility: "published",
    posterUrl: "https://example.org/poster.jpg",
  });
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/events", () => {
  it("lists with filters and pagination", async () => {
    const res = await list(
      new Request("http://x/api/events?city=pune&type=festival&pageSize=10"),
      undefined,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 10, total: 1 });
    expect(body.events[0]).toMatchObject({
      title: "NH7 Weekender",
      startsAt: "2026-12-05T10:00:00.000Z",
      venue: { city: "Pune" },
      artistCount: 1,
    });
  });

  it("400s invalid filters", async () => {
    const res = await list(new Request("http://x/api/events?type=party&pageSize=500"), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
  });
});

describe("GET /api/events/:id", () => {
  it("returns the event with lineup and match status, without source internals", async () => {
    const { items } = await useCases.listEvents(ListEventsQuerySchema.parse({}));
    const res = await getOne(new Request("http://x"), ctx(items[0]!.id));
    expect(res.status).toBe(200);
    const { event } = await res.json();
    expect(event.lineup).toEqual([
      expect.objectContaining({
        name: "The Local Train",
        tier: "headliner",
        billingRank: 1,
        matchStatus: "pending",
      }),
    ]);
    expect(event.sources).toBeUndefined();
  });

  it("includes verification for the UI badge (D-056)", async () => {
    const { items } = await useCases.listEvents(ListEventsQuerySchema.parse({}));
    const { event } = await (await getOne(new Request("http://x"), ctx(items[0]!.id))).json();
    expect(event.verification).toEqual({ sourcesCount: 0, lastVerifiedAt: null, sources: [] });
    expect(event).not.toHaveProperty("visibility");
  });

  it.each(["held", "archived"] as const)(
    "a %s event is 404 and absent from the list",
    async (visibility) => {
      const { items } = await useCases.listEvents(ListEventsQuerySchema.parse({}));
      await world.events.setVisibility(items[0]!.id, visibility);
      expect((await getOne(new Request("http://x"), ctx(items[0]!.id))).status).toBe(404);
      const body = await (await list(new Request("http://x/api/events"), undefined)).json();
      expect(body.total).toBe(0);
    },
  );

  it.each(["nope", "00000000-0000-4000-8000-ffffffffffff"])("404s %s", async (id) => {
    const res = await getOne(new Request("http://x"), ctx(id));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

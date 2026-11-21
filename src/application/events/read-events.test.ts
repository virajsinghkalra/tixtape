import { describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import {
  AdminListEventsQuerySchema,
  getAdminEvent,
  getEvent,
  listAdminEvents,
  listEvents,
  ListEventsQuerySchema,
  parseEventId,
} from "./read-events";
import { createAdminEvent } from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

describe("ListEventsQuerySchema", () => {
  it.each([
    [{}, { page: 1, pageSize: 20 }],
    [
      { page: "3", pageSize: "50" },
      { page: 3, pageSize: 50 },
    ],
    [{ from: "2026-03-01" }, { from: new Date("2026-03-01T00:00:00Z") }],
    [{ to: "2026-03-01" }, { to: new Date("2026-03-01T23:59:59.999Z") }],
    [{ to: "2026-03-01T10:00:00+05:30" }, { to: new Date("2026-03-01T04:30:00Z") }],
  ])("%j → %j", (raw, expected) => {
    expect(ListEventsQuerySchema.parse(raw)).toMatchObject(expected);
  });

  it.each([
    [{ page: "0" }],
    [{ pageSize: "101" }],
    [{ type: "party" }],
    [{ from: "yesterday" }],
    [{ from: "2026-03-02", to: "2026-03-01" }],
    [{ utm_source: "x" }],
  ])("rejects %j", (raw) => {
    expect(ListEventsQuerySchema.safeParse(raw).success).toBe(false);
  });
});

describe("listEvents / getEvent", () => {
  async function seeded() {
    const world = fakeEventsWorld();
    const base = {
      type: "concert" as const,
      status: "announced" as const,
      endsAt: null,
      genre: null,
      imageUrl: null,
      url: null,
      visibility: "published" as const,
      posterUrl: "https://example.org/poster.jpg",
    };
    for (const [title, city, day] of [
      ["Prateek Kuhad Live", "Bangalore", "2026-03-01"],
      ["Anuv Jain Dastakhat Tour", "Mumbai", "2026-03-05"],
      ["Arijit Singh", "Bombay", "2026-04-10"],
    ] as const) {
      await createAdminEvent(world, {
        ...base,
        title,
        startsAt: new Date(`${day}T14:00:00Z`),
        venue: { name: "Phoenix Marketcity", city, country: "IN" },
        lineup: [
          { name: title.split(" ").slice(0, 2).join(" "), tier: "headliner", billingRank: 1 },
        ],
      });
    }
    return world;
  }

  it.each([
    [{ city: "bombay" }, ["Anuv Jain Dastakhat Tour", "Arijit Singh"]],
    [{ city: "Bengaluru" }, ["Prateek Kuhad Live"]],
    [{ q: "tour" }, ["Anuv Jain Dastakhat Tour"]],
    [{ from: "2026-03-02", to: "2026-03-31" }, ["Anuv Jain Dastakhat Tour"]],
    [{ type: "festival" }, []],
  ])("filters %j", async (raw, titles) => {
    const world = await seeded();
    const page = await listEvents(world.events, ListEventsQuerySchema.parse(raw));
    expect(page.items.map((e) => e.title)).toEqual(titles);
    expect(page.total).toBe(titles.length);
  });

  it("paginates", async () => {
    const world = await seeded();
    const page = await listEvents(
      world.events,
      ListEventsQuerySchema.parse({ page: "2", pageSize: "2" }),
    );
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.items.map((e) => e.title)).toEqual(["Arijit Singh"]);
  });

  it("gets one event with its lineup", async () => {
    const world = await seeded();
    const id = world.events.events[0]!.id;
    const event = await getEvent(world.events, id);
    expect(event.lineup[0]).toMatchObject({ name: "Prateek Kuhad", tier: "headliner" });
  });

  it.each(["held", "archived"] as const)(
    "a %s event is hidden from public reads but visible to admins (D-056)",
    async (visibility) => {
      const world = await seeded();
      const target = world.events.events[0]!;
      await world.events.setVisibility(target.id, visibility);
      await expect(getEvent(world.events, target.id)).rejects.toThrow(NotFoundError);
      const page = await listEvents(world.events, ListEventsQuerySchema.parse({}));
      expect(page.items.map((e) => e.id)).not.toContain(target.id);
      expect(page.total).toBe(2);
      expect((await getAdminEvent(world.events, target.id)).visibility).toBe(visibility);
      const admin = await listAdminEvents(
        world.events,
        AdminListEventsQuerySchema.parse({ visibility }),
      );
      expect(admin.items.map((e) => [e.id, e.visibility])).toEqual([[target.id, visibility]]);
    },
  );

  it("public detail carries verification; public rows carry no admin fields", async () => {
    const world = await seeded();
    const target = world.events.events[0]!;
    const checked = new Date("2026-11-20T10:00:00Z");
    world.events.markVerified(target.id, "published", checked);
    target.sources.push({
      source: "ticketmaster",
      externalId: "tm1",
      url: "https://www.ticketmaster.com/e/tm1",
      lastSeenAt: checked,
    });
    const event = await getEvent(world.events, target.id);
    expect(event.verification).toEqual({
      sourcesCount: 1,
      lastVerifiedAt: checked,
      sources: [{ source: "ticketmaster", url: "https://www.ticketmaster.com/e/tm1" }],
    });
    expect(event).not.toHaveProperty("visibility");
    const [row] = (await listEvents(world.events, ListEventsQuerySchema.parse({}))).items;
    expect(row).not.toHaveProperty("confidence");
  });

  it.each([[{ visibility: "hidden" }], [{ visibility: "" }]])("admin list rejects %j", (raw) => {
    expect(AdminListEventsQuerySchema.safeParse(raw).success).toBe(false);
  });

  it.each(["not-a-uuid", "", "1; DROP TABLE events"])("treats id %j as not found", (raw) => {
    expect(() => parseEventId(raw)).toThrow(NotFoundError);
  });

  it("404s a well-formed but unknown id", async () => {
    const world = await seeded();
    await expect(
      getEvent(world.events, parseEventId("00000000-0000-4000-8000-ffffffffffff")),
    ).rejects.toThrow(NotFoundError);
  });
});

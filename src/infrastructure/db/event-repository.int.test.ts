import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "@/application/ports/event-source";
import { ingestEvents } from "@/application/events/ingest-events";
import {
  AdminListEventsQuerySchema,
  getAdminEvent,
  getEvent,
  listAdminEvents,
  listEvents,
  ListEventsQuerySchema,
} from "@/application/events/read-events";
import {
  AdminEventInputSchema,
  AdminEventPatchSchema,
  createAdminEvent,
  updateAdminEvent,
} from "@/application/events/save-admin-event";
import type { RawEvent } from "@/domain/events/raw-event";
import { asEventId } from "@/domain/shared/ids";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { events } from "@/db/schema";
import { testDb } from "../../../tests/setup/db";
import { PgArtistRepository } from "./artist-repository";
import { PgEventRepository } from "./event-repository";
import { truncateEventTables } from "./events-test-db";
import { PgIngestRunRepository } from "./ingest-run-repository";
import { PgVenueRepository } from "./venue-repository";

const db = testDb();
afterAll(() => db.$close());
beforeEach(() => truncateEventTables(db));

const now = new Date("2026-11-21T06:00:00Z");
const deps = {
  events: new PgEventRepository(db),
  venues: new PgVenueRepository(db),
  artists: new PgArtistRepository(db),
  ingestRuns: new PgIngestRunRepository(db),
  clock: { now: () => now },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

const tm = (overrides: Partial<RawEvent> = {}): RawEvent => ({
  source: "ticketmaster",
  externalId: "G5vYZ9",
  url: "https://www.ticketmaster.com/event/G5vYZ9",
  title: "Lollapalooza India 2026",
  type: "festival",
  startsAt: new Date("2026-03-07T08:30:00Z"),
  status: "announced",
  genre: "Rock",
  imageUrl: "https://s1.ticketm.net/lolla.jpg",
  venue: { name: "Mahalakshmi Race Course", city: "Bombay", country: "IN", lat: 18.98, lng: 72.82 },
  lineup: [
    { name: "Linkin Park", tier: "headliner", billingRank: 1 },
    { name: "Nucleya b2b Ritviz", tier: "sub", billingRank: 2 },
  ],
  raw: { id: "G5vYZ9" },
  ...overrides,
});

const adapter = (items: RawEvent[]): SourceAdapter => ({
  source: "ticketmaster",
  async *fetch() {
    yield* items;
  },
});

const opts = { from: new Date("2026-01-01T00:00:00Z") };

describe("PgEventRepository through the use cases", () => {
  it("ingests an event with venue, source, artists and ordered lineup, and records the run", async () => {
    const summary = await ingestEvents(deps, adapter([tm()]), opts);
    expect(summary).toMatchObject({ status: "succeeded", itemsSeen: 1, itemsNew: 1 });

    const id = await deps.events.findIdBySourceRef("ticketmaster", "G5vYZ9");
    expect(id).not.toBeNull();
    const event = await getAdminEvent(deps.events, id!);
    expect(event).toMatchObject({
      title: "Lollapalooza India 2026",
      type: "festival",
      status: "announced",
      venue: { name: "Mahalakshmi Race Course", city: "Mumbai", country: "IN" },
      artistCount: 3,
      sources: [
        {
          source: "ticketmaster",
          externalId: "G5vYZ9",
          url: "https://www.ticketmaster.com/event/G5vYZ9",
          lastSeenAt: now,
        },
      ],
    });
    expect(event.lineup.map((a) => [a.name, a.tier, a.billingRank, a.matchStatus])).toEqual([
      ["Linkin Park", "headliner", 1, "pending"],
      ["Nucleya", "sub", 2, "pending"],
      ["Ritviz", "sub", 3, "pending"],
    ]);
    expect(event.lineupHash).toMatch(/^[0-9a-f]{64}$/u);

    const runs = await db.query.ingestRuns.findMany();
    expect(runs).toEqual([
      expect.objectContaining({
        source: "ticketmaster",
        status: "succeeded",
        itemsSeen: 1,
        itemsNew: 1,
        finishedAt: now,
        error: null,
      }),
    ]);
  });

  it("persists starts_at_date_only (D-034) and clears it on a later timed update", async () => {
    await ingestEvents(deps, adapter([tm({ startsAtDateOnly: true })]), opts);
    expect((await db.query.events.findMany())[0]!.startsAtDateOnly).toBe(true);
    await ingestEvents(deps, adapter([tm({ startsAtDateOnly: false })]), opts);
    expect((await db.query.events.findMany())[0]!.startsAtDateOnly).toBe(false);
  });

  it("re-ingesting is idempotent and the stored record exposes all contributing sources", async () => {
    await ingestEvents(deps, adapter([tm()]), opts);
    const again = await ingestEvents(deps, adapter([tm(), tm()]), opts);
    expect(again).toMatchObject({ itemsNew: 0, itemsUpdated: 2 });
    expect(await db.query.events.findMany()).toHaveLength(1);
    expect(await db.query.artists.findMany()).toHaveLength(3);
    expect(await db.query.venues.findMany()).toHaveLength(1);
  });

  it("admin entry merges with a Ticketmaster event and keeps admin precedence afterwards", async () => {
    await ingestEvents(deps, adapter([tm()]), opts);
    const created = await createAdminEvent(
      deps,
      AdminEventInputSchema.parse({
        title: "Lollapalooza India",
        type: "festival",
        status: "full_lineup",
        startsAt: "2026-03-07T14:00:00+05:30",
        venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
        lineup: [
          { name: "Linkin Park", tier: "headliner" },
          { name: "Nucleya", tier: "sub" },
          { name: "Ritviz", tier: "sub" },
          { name: "Anuv Jain", tier: "mid" },
        ],
      }),
    );
    expect(created.outcome).toBe("merged");
    expect(created.event).toMatchObject({
      title: "Lollapalooza India",
      status: "full_lineup",
      artistCount: 4,
    });

    await ingestEvents(deps, adapter([tm({ title: "Lolla India (TM)", lineup: [] })]), opts);
    const after = await getAdminEvent(deps.events, created.event.id);
    expect(after).toMatchObject({
      title: "Lollapalooza India",
      status: "full_lineup",
      artistCount: 4,
    });
    expect(after.sources.map((s) => s.source)).toEqual(["admin", "ticketmaster"]);
  });

  it("admin patch replaces the lineup and changes the hash; a clashing edit is a ConflictError", async () => {
    const input = AdminEventInputSchema.parse({
      title: "Zomaland",
      type: "festival",
      startsAt: "2026-02-14T10:00:00Z",
      venue: { name: "JLN Stadium", city: "New Delhi", country: "IN" },
      lineup: [{ name: "Divine", tier: "headliner" }],
    });
    const { event } = await createAdminEvent(deps, input);
    const patched = await updateAdminEvent(
      deps,
      event.id,
      AdminEventPatchSchema.parse({
        lineup: [
          { name: "Seedhe Maut", tier: "headliner" },
          { name: "Divine", tier: "sub" },
        ],
      }),
    );
    expect(patched.event.lineup.map((a) => a.name)).toEqual(["Seedhe Maut", "Divine"]);
    expect(patched.event.lineupHash).not.toBe(event.lineupHash);

    const other = await createAdminEvent(deps, {
      ...input,
      title: "Comic Con",
      venue: { name: "NSIC Grounds", city: "Delhi", country: "IN" },
    });
    await expect(
      updateAdminEvent(deps, other.event.id, AdminEventPatchSchema.parse({ title: "Zomaland" })),
    ).rejects.toThrow(ConflictError);
  });

  it("lists with filters, escaping LIKE wildcards, and paginates", async () => {
    await ingestEvents(
      deps,
      adapter([
        tm(),
        tm({
          externalId: "b",
          title: "100% Bollywood Night",
          startsAt: new Date("2026-03-20T14:00:00Z"),
          type: "concert",
          lineup: [],
        }),
        tm({
          externalId: "c",
          title: "Sunburn Arena",
          startsAt: new Date("2026-03-25T14:00:00Z"),
          venue: { name: "Phoenix Marketcity", city: "Bangalore", country: "IN" },
          lineup: [],
        }),
      ]),
      opts,
    );
    const list = (q: Record<string, string>) =>
      listAdminEvents(deps.events, AdminListEventsQuerySchema.parse(q));

    expect((await list({ city: "bombay" })).items.map((e) => e.title)).toEqual([
      "Lollapalooza India 2026",
      "100% Bollywood Night",
    ]);
    expect((await list({ q: "100%" })).items.map((e) => e.title)).toEqual(["100% Bollywood Night"]);
    expect((await list({ q: "%" })).total).toBe(1);
    expect((await list({ type: "concert" })).total).toBe(1);
    expect((await list({ from: "2026-03-08", to: "2026-03-20" })).total).toBe(1);
    const page = await list({ page: "2", pageSize: "2" });
    expect(page).toMatchObject({ total: 3, page: 2 });
    expect(page.items).toHaveLength(1);
    expect((await list({})).items[0]).toMatchObject({ artistCount: 3, venue: { city: "Mumbai" } });
  });

  it("D-056: ingested events start held; public reads see only published, admin reads see all", async () => {
    await ingestEvents(deps, adapter([tm()]), opts);
    const id = (await deps.events.findIdBySourceRef("ticketmaster", "G5vYZ9"))!;
    const publicList = () => listEvents(deps.events, ListEventsQuerySchema.parse({}));
    const adminList = (visibility?: string) =>
      listAdminEvents(
        deps.events,
        AdminListEventsQuerySchema.parse(visibility ? { visibility } : {}),
      );

    expect((await getAdminEvent(deps.events, id)).visibility).toBe("held");
    await expect(getEvent(deps.events, id)).rejects.toThrow(NotFoundError);
    expect((await publicList()).total).toBe(0);

    await db
      .update(events)
      .set({ visibility: "published", lastVerifiedAt: now })
      .where(eq(events.id, id));
    const published = await getEvent(deps.events, id);
    expect(published).not.toHaveProperty("visibility");
    expect(published.verification).toEqual({
      sourcesCount: 1,
      lastVerifiedAt: now,
      sources: [{ source: "ticketmaster", url: "https://www.ticketmaster.com/event/G5vYZ9" }],
    });
    expect((await publicList()).items.map((e) => e.id)).toEqual([id]);
    expect((await publicList()).items[0]).not.toHaveProperty("confidence");

    await db.update(events).set({ visibility: "archived" }).where(eq(events.id, id));
    // D-070: archived stays reachable by its link (QA-F-12), and is never listed.
    expect(await getEvent(deps.events, id)).toMatchObject({ id, archived: true });
    expect((await publicList()).total).toBe(0);
    expect((await adminList()).items.map((e) => [e.id, e.visibility])).toEqual([[id, "archived"]]);
    expect((await adminList("held")).total).toBe(0);
  });

  it("D-056: an admin save publishes only when asked, and PATCH changes visibility", async () => {
    const input = AdminEventInputSchema.parse({
      title: "Zomaland",
      type: "festival",
      startsAt: "2026-02-14T10:00:00Z",
      venue: { name: "JLN Stadium", city: "Delhi", country: "IN" },
      lineup: [{ name: "Divine", tier: "headliner" }],
      posterUrl: "https://example.org/zomaland.jpg",
    });
    const held = await createAdminEvent(deps, input);
    expect(held.event.visibility).toBe("held");
    const published = await updateAdminEvent(
      deps,
      held.event.id,
      AdminEventPatchSchema.parse({ visibility: "published" }),
    );
    expect(published.event).toMatchObject({ visibility: "published", title: "Zomaland" });
    expect(published.event.lineupHash).toBe(held.event.lineupHash);
    const other = await createAdminEvent(deps, {
      ...input,
      title: "Comic Con",
      visibility: "published",
    });
    expect(other.event.visibility).toBe("published");
  });

  it("a visibility-only PATCH changes nothing else: no admin source, Ticketmaster keeps ownership (QA-E-7)", async () => {
    await ingestEvents(deps, adapter([tm()]), opts);
    const id = (await deps.events.findIdBySourceRef("ticketmaster", "G5vYZ9"))!;
    await deps.events.setPoster(id, "https://example.org/lolla.jpg"); // D-091: a picture to publish with
    const before = await getAdminEvent(deps.events, id);

    const res = await updateAdminEvent(
      deps,
      id,
      AdminEventPatchSchema.parse({ visibility: "published" }),
    );
    expect(res.event.visibility).toBe("published");
    expect(res.event.sources.map((s) => s.source)).toEqual(["ticketmaster"]);
    // `lineupCompleteness` and `picture` are computed on the admin read, not stored fields.
    const {
      visibility: _a,
      updatedAt: _b,
      lineupCompleteness: _l,
      picture: _p,
      ...restBefore
    } = before;
    const { visibility: _c, updatedAt: _d, ...restAfter } = res.event;
    expect(restAfter).toEqual(restBefore);

    // Ticketmaster still owns the fields, so its next update applies.
    await ingestEvents(deps, adapter([tm({ title: "Lollapalooza India 2026 (Day 1)" })]), opts);
    expect((await getAdminEvent(deps.events, id)).title).toBe("Lollapalooza India 2026 (Day 1)");
    expect((await getAdminEvent(deps.events, id)).visibility).toBe("published");
  });

  it("a visibility PATCH on a missing event is a 404", async () => {
    await expect(
      updateAdminEvent(
        deps,
        asEventId("00000000-0000-4000-8000-000000000000"),
        AdminEventPatchSchema.parse({ visibility: "held" }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("a NUL byte in the search text never reaches Postgres (QA-F-14)", async () => {
    await ingestEvents(deps, adapter([tm()]), opts);
    const page = await listAdminEvents(
      deps.events,
      AdminListEventsQuerySchema.parse({ q: "Lolla\u0000" }),
    );
    expect(page.total).toBe(1);
  });

  it("returns null for an unknown id", async () => {
    expect(
      await deps.events.getDetail(asEventId("00000000-0000-4000-8000-000000000000")),
    ).toBeNull();
    expect(
      await deps.events.findById(asEventId("00000000-0000-4000-8000-000000000000")),
    ).toBeNull();
  });
});

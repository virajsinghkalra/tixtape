/** D-072: a residency or tour is several events, and a merge never quietly moves a date. */
import { describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { RawEvent } from "@/domain/events/raw-event";
import { ingestEvents } from "./ingest-events";
import { AdminEventInputSchema, createAdminEvent } from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

const ist = (day: number, hh = 19, mm = 30) =>
  new Date(Date.UTC(2026, 11, day, hh, mm) - 330 * 60_000);

const sketchbook = (startsAt: Date, venue = "TBA") =>
  AdminEventInputSchema.parse({
    title: "Sketchbook by Bhuwin Khursija – Mumbai",
    type: "concert",
    startsAt: startsAt.toISOString(),
    venue: { name: venue, city: "Mumbai", country: "IN" },
    lineup: [{ name: "Bhuwin Khursija", tier: "headliner" }],
  });

const raw = (over: Partial<RawEvent>): RawEvent => ({
  source: "ticketmaster",
  externalId: "tm-1",
  title: "Sketchbook by Bhuwin Khursija – Mumbai",
  type: "concert",
  startsAt: ist(5),
  venue: { name: "NSCI Dome", city: "Mumbai", country: "IN" },
  lineup: [{ name: "Bhuwin Khursija", tier: "headliner", billingRank: 1 }],
  raw: {},
  ...over,
});
const feed = (source: RawEvent["source"], items: RawEvent[]): SourceAdapter => ({
  source,
  async *fetch() {
    yield* items;
  },
});
const setup = () => {
  const world = fakeEventsWorld(new Date("2026-11-21T00:00:00Z"));
  return { world, deps: { ...world, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } };
};
const starts = (world: ReturnType<typeof fakeEventsWorld>) =>
  world.events.events.map((e) => e.startsAt.toISOString()).sort();

describe("D-072 write path", () => {
  it("the reported residency: 5, 6 and 9 Dec stay three events, and 5 Dec keeps its date", async () => {
    const { world, deps } = setup();
    const results = [];
    for (const day of [5, 6, 9]) results.push(await createAdminEvent(deps, sketchbook(ist(day))));
    expect(results.map((r) => r.outcome)).toEqual(["created", "created", "created"]);
    expect(new Set(results.map((r) => r.event.id)).size).toBe(3);
    expect(starts(world)).toEqual([ist(5), ist(6), ist(9)].map((d) => d.toISOString()));
    expect(world.events.mergeReviews).toEqual([]);
  });

  it("the same night entered twice still merges", async () => {
    const { world, deps } = setup();
    const first = await createAdminEvent(deps, sketchbook(ist(5), "NSCI Dome"));
    const again = await createAdminEvent(deps, sketchbook(ist(5), "NSCI Dome"));
    expect(again).toMatchObject({ outcome: "merged", event: { id: first.event.id } });
    expect(world.events.events).toHaveLength(1);
  });

  it("an early and a late show the same night: separate events, flagged for review", async () => {
    const { world, deps } = setup();
    const early = await createAdminEvent(deps, sketchbook(ist(5, 19, 30), "NSCI Dome"));
    const late = await createAdminEvent(deps, sketchbook(ist(5, 22, 30), "NSCI Dome"));
    expect(late.event.id).not.toBe(early.event.id);
    expect(starts(world)).toEqual([ist(5, 19, 30), ist(5, 22, 30)].map((d) => d.toISOString()));
    expect(world.events.mergeReviews).toEqual([
      expect.objectContaining({ eventId: late.event.id, similarTo: early.event.id }),
    ]);
  });

  it("a late-night show on the next IST date but the same UTC date gets its own key", async () => {
    const { world, deps } = setup();
    await createAdminEvent(deps, sketchbook(ist(5, 19, 30)));
    const lateNight = await createAdminEvent(deps, sketchbook(ist(6, 0, 30)));
    expect(world.events.events).toHaveLength(2);
    const keys = world.events.events.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(2);
    expect(lateNight.event.startsAt).toEqual(ist(6, 0, 30));
  });

  it("same night from two feeds with a 1-day slip: review, the stored date untouched", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed("ticketmaster", [raw({})]), { from: new Date(0) });
    const slipped = raw({ source: "sunburn", externalId: "sb-1", startsAt: ist(6, 0, 15) });
    const summary = await ingestEvents(deps, feed("sunburn", [slipped]), { from: new Date(0) });
    expect(summary).toMatchObject({ itemsMerged: 0, itemsForReview: 1 });
    const tm = world.events.events.find((e) => e.sources.some((s) => s.source === "ticketmaster"))!;
    expect(tm.startsAt).toEqual(ist(5));
    expect(world.events.mergeReviews).toHaveLength(1);
  });

  it("date-only vs a timed listing on another IST date: review", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed("ticketmaster", [raw({})]), { from: new Date(0) });
    const dateOnly = raw({
      source: "wikipedia",
      externalId: "wp-1",
      startsAt: ist(6, 0, 0),
      startsAtDateOnly: true,
    });
    const summary = await ingestEvents(deps, feed("wikipedia", [dateOnly]), { from: new Date(0) });
    expect(summary).toMatchObject({ itemsMerged: 0, itemsForReview: 1 });
    expect(
      world.events.events.find((e) => e.sources.some((s) => s.source === "ticketmaster"))!.startsAt,
    ).toEqual(ist(5));
  });

  it("an equal-rank source with another time doesn't move the start: review instead", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed("ticketmaster", [raw({})]), { from: new Date(0) });
    const otherListing = raw({ externalId: "tm-2", startsAt: ist(5, 21, 0) });
    const summary = await ingestEvents(deps, feed("ticketmaster", [otherListing]), {
      from: new Date(0),
    });
    expect(summary).toMatchObject({ itemsMerged: 0, itemsForReview: 1 });
    expect(starts(world)).toEqual([ist(5), ist(5, 21, 0)].map((d) => d.toISOString()));
  });

  it("a strictly higher-ranked source may correct the time of the same night", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed("ticketmaster", [raw({})]), { from: new Date(0) });
    const fixed = await createAdminEvent(deps, sketchbook(ist(5, 20, 0), "NSCI Dome"));
    expect(fixed.outcome).toBe("merged");
    expect(world.events.events).toHaveLength(1);
    expect(world.events.events[0]!.startsAt).toEqual(ist(5, 20, 0));
  });

  it("a lower-ranked source merges into the same night but never moves the start", async () => {
    const { world, deps } = setup();
    await createAdminEvent(deps, sketchbook(ist(5), "NSCI Dome"));
    const tm = raw({ startsAt: ist(5, 21, 0) });
    const summary = await ingestEvents(deps, feed("ticketmaster", [tm]), { from: new Date(0) });
    expect(summary).toMatchObject({ itemsMerged: 1 });
    expect(world.events.events).toHaveLength(1);
    expect(world.events.events[0]!.startsAt).toEqual(ist(5));
  });

  it("a source updating its own listing (same external id) may still move its date", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed("ticketmaster", [raw({})]), { from: new Date(0) });
    await ingestEvents(deps, feed("ticketmaster", [raw({ startsAt: ist(7) })]), {
      from: new Date(0),
    });
    expect(starts(world)).toEqual([ist(7).toISOString()]);
  });
});

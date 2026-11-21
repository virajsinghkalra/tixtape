/** D-072 on real Postgres: candidate sources and flags come from SQL, keys are unique. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestEvents } from "@/application/events/ingest-events";
import { AdminEventInputSchema, createAdminEvent } from "@/application/events/save-admin-event";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { RawEvent } from "@/domain/events/raw-event";
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

const eventsRepo = new PgEventRepository(db);
const deps = {
  events: eventsRepo,
  venues: new PgVenueRepository(db),
  artists: new PgArtistRepository(db),
  ingestRuns: new PgIngestRunRepository(db),
  clock: { now: () => new Date("2026-11-21T00:00:00Z") },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

const ist = (day: number, hh = 19, mm = 30) =>
  new Date(Date.UTC(2026, 11, day, hh, mm) - 330 * 60_000);
const sketchbook = (startsAt: Date) =>
  AdminEventInputSchema.parse({
    title: "Sketchbook by Bhuwin Khursija – Mumbai",
    type: "concert",
    startsAt: startsAt.toISOString(),
    venue: { name: "TBA", city: "Mumbai", country: "IN" },
    lineup: [{ name: "Bhuwin Khursija", tier: "headliner" }],
  });
const starts = async () =>
  (await db.select({ s: events.startsAt }).from(events)).map((r) => r.s.toISOString()).sort();

describe("D-072 on Postgres", () => {
  it("the reported residency 5/6/9 Dec creates three events and never moves 5 Dec", async () => {
    const outcomes = [];
    for (const day of [5, 6, 9])
      outcomes.push((await createAdminEvent(deps, sketchbook(ist(day)))).outcome);
    expect(outcomes).toEqual(["created", "created", "created"]);
    expect(await starts()).toEqual([ist(5), ist(6), ist(9)].map((d) => d.toISOString()));
    expect(await eventsRepo.listMergeReviews(10)).toEqual([]);
  });

  it("two shows that share a UTC date are stored with distinct keys and a review row", async () => {
    const first = await createAdminEvent(deps, sketchbook(ist(5, 19, 30)));
    const second = await createAdminEvent(deps, sketchbook(ist(6, 0, 30)));
    expect(second.event.id).not.toBe(first.event.id);
    const keys = (await db.select({ k: events.dedupeKey }).from(events)).map((r) => r.k).sort();
    expect(keys).toEqual([
      "sketchbook by bhuwin khursija mumbai|2026-12-05|mumbai",
      "sketchbook by bhuwin khursija mumbai|2026-12-05|mumbai|19:00",
    ]);
  });

  it("the same night from two feeds with a 1-day slip goes to review, never merged", async () => {
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
    const feed = (items: RawEvent[]): SourceAdapter => ({
      source: items[0]!.source,
      async *fetch() {
        yield* items;
      },
    });
    await ingestEvents(deps, feed([raw({})]), { from: new Date(0) });
    const summary = await ingestEvents(
      deps,
      feed([raw({ source: "sunburn", externalId: "sb-1", startsAt: ist(6, 0, 15) })]),
      { from: new Date(0) },
    );
    expect(summary).toMatchObject({ itemsMerged: 0, itemsForReview: 1 });
    expect(await starts()).toEqual([ist(5), ist(6, 0, 15)].map((d) => d.toISOString()));
    expect(await eventsRepo.listMergeReviews(10)).toHaveLength(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { RawEvent } from "@/domain/events/raw-event";
import { lineupHash } from "@/domain/events/lineup";
import { UpstreamError } from "@/lib/errors";
import { ingestEvents } from "./ingest-events";
import { createAdminEvent } from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

const tmEvent = (overrides: Partial<RawEvent> = {}): RawEvent => ({
  source: "ticketmaster",
  externalId: "Z7r9jZ1A7a",
  url: "https://www.ticketmaster.com/event/Z7r9jZ1A7a",
  title: "Lollapalooza India 2026",
  type: "festival",
  startsAt: new Date("2026-03-07T08:30:00Z"),
  endsAt: undefined,
  status: "announced",
  genre: "Rock",
  imageUrl: "https://s1.ticketm.net/lolla.jpg",
  venue: { name: "Mahalakshmi Race Course", city: "Bombay", country: "IN" },
  lineup: [
    { name: "Linkin Park", tier: "headliner", billingRank: 1 },
    { name: "Glass Animals", tier: "sub", billingRank: 2 },
    { name: "Nucleya b2b Ritviz", tier: "mid", billingRank: 3 },
  ],
  raw: { id: "Z7r9jZ1A7a" },
  ...overrides,
});

function adapter(events: RawEvent[], failAfter?: number): SourceAdapter {
  return {
    source: "ticketmaster",
    async *fetch() {
      let i = 0;
      for (const e of events) {
        if (failAfter !== undefined && i++ === failAfter) {
          throw new UpstreamError("ticketmaster", "Ticketmaster returned 503");
        }
        yield e;
      }
    },
  };
}

const quietLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function setup() {
  const world = fakeEventsWorld();
  const logger = quietLogger();
  return { ...world, logger, deps: { ...world, logger } };
}

const opts = { from: new Date("2026-01-01T00:00:00Z") };

describe("ingestEvents", () => {
  it("creates venue, event, source, artists and lineup, and records the run", async () => {
    const { deps, events, artists, venues, ingestRuns } = setup();
    const summary = await ingestEvents(deps, adapter([tmEvent()]), opts);

    expect(summary).toMatchObject({
      status: "succeeded",
      itemsSeen: 1,
      itemsNew: 1,
      itemsFailed: 0,
    });
    expect(venues.venues).toHaveLength(1);
    expect(venues.venues[0]).toMatchObject({
      normalizedName: "mahalaxmi racecourse",
      city: "Mumbai",
    });
    expect(artists.artists.map((a) => a.name)).toEqual([
      "Linkin Park",
      "Glass Animals",
      "Nucleya",
      "Ritviz",
    ]);
    const [event] = events.events;
    expect(event).toMatchObject({
      title: "Lollapalooza India 2026",
      dedupeKey: "lollapalooza india|2026-03-07|mumbai",
      lineupHash: lineupHash([
        { name: "Linkin Park", tier: "headliner" },
        { name: "Glass Animals", tier: "sub" },
        { name: "Nucleya", tier: "mid" },
        { name: "Ritviz", tier: "mid" },
      ]),
    });
    expect(event!.lineup.map((r) => r.billingRank)).toEqual([1, 2, 3, 4]);
    expect(event!.sources).toEqual([
      expect.objectContaining({ source: "ticketmaster", externalId: "Z7r9jZ1A7a" }),
    ]);
    expect(ingestRuns.runs[0]).toMatchObject({
      source: "ticketmaster",
      status: "succeeded",
      itemsSeen: 1,
      itemsNew: 1,
      error: null,
    });
  });

  it("stores startsAtDateOnly and clears it when the source later sends a time (D-034)", async () => {
    const { deps, events } = setup();
    await ingestEvents(deps, adapter([tmEvent({ startsAtDateOnly: true })]), opts);
    expect(events.events[0]!.startsAtDateOnly).toBe(true);
    await ingestEvents(deps, adapter([tmEvent({ startsAtDateOnly: false })]), opts);
    expect(events.events[0]!.startsAtDateOnly).toBe(false);
    await ingestEvents(deps, adapter([tmEvent({ startsAtDateOnly: undefined })]), opts);
    expect(events.events[0]!.startsAtDateOnly).toBe(false);
  });

  it("an admin-owned start time isn't replaced by a lower source's date-only one", async () => {
    const { deps, events } = setup();
    await createAdminEvent(deps, {
      title: "Lollapalooza India",
      type: "festival",
      status: "full_lineup",
      startsAt: new Date("2026-03-07T09:00:00Z"),
      endsAt: null,
      genre: null,
      imageUrl: null,
      url: null,
      venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
      lineup: [{ name: "Linkin Park", tier: "headliner", billingRank: 1 }],
    });
    await ingestEvents(deps, adapter([tmEvent({ startsAtDateOnly: true })]), opts);
    expect(events.events[0]).toMatchObject({
      startsAt: new Date("2026-03-07T09:00:00Z"),
      startsAtDateOnly: false,
    });
  });

  it("is idempotent: a second run updates the same event", async () => {
    const { deps, events, artists } = setup();
    await ingestEvents(deps, adapter([tmEvent()]), opts);
    const second = await ingestEvents(
      deps,
      adapter([tmEvent({ title: "Lollapalooza India" })]),
      opts,
    );
    expect(second).toMatchObject({ itemsNew: 0, itemsUpdated: 1 });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]!.title).toBe("Lollapalooza India");
    expect(artists.artists).toHaveLength(4);
  });

  it("keeps the stored lineup when the source sends an empty one", async () => {
    const { deps, events } = setup();
    await ingestEvents(deps, adapter([tmEvent()]), opts);
    const hash = events.events[0]!.lineupHash;
    await ingestEvents(deps, adapter([tmEvent({ lineup: [] })]), opts);
    expect(events.events[0]!.lineupHash).toBe(hash);
    expect(events.events[0]!.lineup).toHaveLength(4);
  });

  it("merges into an admin event without overwriting admin fields, filling only gaps", async () => {
    const { deps, events } = setup();
    const admin = await createAdminEvent(deps, {
      title: "Lollapalooza India",
      type: "festival",
      status: "full_lineup",
      startsAt: new Date("2026-03-07T09:00:00Z"),
      endsAt: null,
      genre: null,
      imageUrl: null,
      url: null,
      venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
      lineup: [
        { name: "Linkin Park", tier: "headliner", billingRank: 1 },
        { name: "Glass Animals", tier: "headliner", billingRank: 2 },
        { name: "Nucleya", tier: "sub", billingRank: 3 },
        { name: "Ritviz", tier: "sub", billingRank: 4 },
      ],
    });
    const adminHash = events.events[0]!.lineupHash;

    const summary = await ingestEvents(deps, adapter([tmEvent()]), opts);

    expect(summary).toMatchObject({ itemsNew: 0, itemsMerged: 1 });
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toMatchObject({
      id: admin.event.id,
      title: "Lollapalooza India",
      status: "full_lineup",
      startsAt: new Date("2026-03-07T09:00:00Z"),
      genre: "Rock",
      imageUrl: "https://s1.ticketm.net/lolla.jpg",
      lineupHash: adminHash,
    });
    expect(events.events[0]!.sources.map((s) => s.source).sort()).toEqual([
      "admin",
      "ticketmaster",
    ]);
  });

  it("creates a separate event flagged for review when dedupe is unsure", async () => {
    const { deps, events, logger } = setup();
    await ingestEvents(deps, adapter([tmEvent()]), opts);
    const similar = tmEvent({
      externalId: "other",
      title: "Lollapalooza India After Party",
      lineup: [{ name: "Linkin Park", tier: "headliner", billingRank: 1 }],
    });
    const summary = await ingestEvents(deps, adapter([similar]), opts);
    expect(summary).toMatchObject({ itemsNew: 1, itemsForReview: 1 });
    expect(events.events).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ similarTo: events.events[0]!.id }),
      "ingest: possible duplicate event needs review",
    );
  });

  it("records the possible duplicate in the review queue, once (D-028)", async () => {
    const { deps, events } = setup();
    await ingestEvents(deps, adapter([tmEvent()]), opts);
    const similar = tmEvent({
      externalId: "other",
      title: "Lollapalooza India After Party",
      lineup: [{ name: "Linkin Park", tier: "headliner", billingRank: 1 }],
    });
    await ingestEvents(deps, adapter([similar]), opts);
    await ingestEvents(deps, adapter([similar]), opts);
    const [first, second] = events.events;
    expect(events.mergeReviews).toEqual([
      expect.objectContaining({ eventId: second!.id, similarTo: first!.id }),
    ]);
    expect(events.mergeReviews[0]!.score).toBeGreaterThanOrEqual(0.6);
  });

  it("merges by dedupe key when title, date and city match but the venue differs", async () => {
    const { deps, events } = setup();
    await ingestEvents(deps, adapter([tmEvent({ lineup: [] })]), opts);
    const other = tmEvent({
      externalId: "other",
      venue: { name: "Jio World Garden", city: "Mumbai", country: "IN" },
      lineup: [],
    });
    const summary = await ingestEvents(deps, adapter([other]), opts);
    expect(summary).toMatchObject({ itemsMerged: 1 });
    expect(events.events).toHaveLength(1);
  });

  it("logs and counts an event that fails to save, and keeps going", async () => {
    const { deps, events, logger, ingestRuns } = setup();
    vi.spyOn(events, "save").mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    const summary = await ingestEvents(
      deps,
      adapter([tmEvent(), tmEvent({ externalId: "b", title: "Sunburn Arena", lineup: [] })]),
      opts,
    );
    expect(summary).toMatchObject({
      itemsSeen: 2,
      itemsNew: 1,
      itemsFailed: 1,
      status: "succeeded",
    });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(ingestRuns.runs[0]!.error).toBe("1 event(s) failed to save");
  });

  it("marks the run failed and rethrows when the source fails", async () => {
    const { deps, ingestRuns } = setup();
    await expect(ingestEvents(deps, adapter([tmEvent(), tmEvent()], 1), opts)).rejects.toThrow(
      UpstreamError,
    );
    expect(ingestRuns.runs[0]).toMatchObject({
      status: "failed",
      itemsSeen: 1,
      itemsNew: 1,
      error: "Ticketmaster returned 503",
      finishedAt: new Date("2026-01-15T00:00:00Z"),
    });
  });
});

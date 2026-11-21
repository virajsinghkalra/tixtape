/** D-091 on the write path: known acts and verified lineups are not split. */
import { describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "@/application/ports/event-source";
import type { RawEvent } from "@/domain/events/raw-event";
import { ingestEvents } from "./ingest-events";
import { AdminEventInputSchema, createAdminEvent } from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

const setup = () => {
  const world = fakeEventsWorld(new Date("2026-11-21T00:00:00Z"));
  return { world, deps: { ...world, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } };
};
const names = (world: ReturnType<typeof fakeEventsWorld>) =>
  world.events.events[0]!.lineup.map(
    (r) => world.artists.artists.find((a) => a.id === r.artistId)!.name,
  );

const raw = (lineup: string[]): RawEvent => ({
  source: "ticketmaster",
  externalId: "tm-weverse",
  title: "Weverse Con India",
  type: "festival",
  startsAt: new Date("2027-01-16T12:00:00Z"),
  venue: { name: "Jio World Garden", city: "Mumbai", country: "IN" },
  lineup: lineup.map((name, i) => ({
    name,
    tier: i === 0 ? "headliner" : "mid",
    billingRank: i + 1,
  })),
  raw: {},
});
const feed = (items: RawEvent[]): SourceAdapter => ({
  source: "ticketmaster",
  async *fetch() {
    yield* items;
  },
});

describe("lineup credits on the write path (D-091)", () => {
  it("a feed never splits an allow-listed act", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed([raw(["TOMORROW X TOGETHER", "Nucleya b2b Ritviz"])]), {
      from: new Date(0),
    });
    expect(names(world)).toEqual(["TOMORROW X TOGETHER", "Nucleya", "Ritviz"]);
  });

  it("a feed doesn't split a credit that is already a known artist", async () => {
    const { world, deps } = setup();
    await world.artists.findOrCreateByName("Stray X Kids", "stray x kids");
    await ingestEvents(deps, feed([raw(["Stray X Kids"])]), { from: new Date(0) });
    expect(names(world)).toEqual(["Stray X Kids"]);
  });

  it("a verified (admin) lineup keeps every name as given", async () => {
    const { world, deps } = setup();
    await createAdminEvent(
      deps,
      AdminEventInputSchema.parse({
        title: "Weverse Con India",
        type: "festival",
        startsAt: "2027-01-16T12:00:00Z",
        venue: { name: "Jio World Garden", city: "Mumbai", country: "IN" },
        lineup: [
          { name: "TOMORROW X TOGETHER", tier: "headliner" },
          { name: "Nucleya b2b Ritviz", tier: "sub" },
          { name: "Khan & Noor", tier: "mid" },
        ],
      }),
    );
    expect(names(world)).toEqual(["TOMORROW X TOGETHER", "Nucleya b2b Ritviz", "Khan & Noor"]);
  });

  it("a duo credited with '&' stays one row for Matching to review (D-066)", async () => {
    const { world, deps } = setup();
    await ingestEvents(deps, feed([raw(["Khan & Noor"])]), { from: new Date(0) });
    expect(names(world)).toEqual(["Khan & Noor"]);
  });
});

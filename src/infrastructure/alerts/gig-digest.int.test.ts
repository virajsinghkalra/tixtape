import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { events, gateDecisions, gigLeads, publishAudit, venues } from "@/db/schema";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { AUTO_GATE_ACTOR, countAutoPublished, loadGigActivity } from "./gig-digest";

const db = testDb();
const NOW = new Date("2026-11-21T12:00:00Z");
const since = new Date(NOW.getTime() - 24 * 3600_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function event(title: string): Promise<string> {
  const [v] = await db
    .insert(venues)
    .values({ name: "Hall", normalizedName: `hall-${title}`, city: "Pune", country: "IN" })
    .returning({ id: venues.id });
  const [e] = await db
    .insert(events)
    .values({
      title,
      type: "concert",
      startsAt: new Date("2026-12-05T13:30:00Z"),
      dedupeKey: title,
      venueId: v!.id,
    })
    .returning({ id: events.id });
  return e!.id;
}

const source = { url: "https://ritviz.com/tour", domain: "ritviz.com", officialKind: "artist" };

describe("gig digest queries", () => {
  it("counts only auto-gate publishes inside the window", async () => {
    const id = await event("Ritviz Live");
    await db.insert(publishAudit).values([
      {
        eventId: id,
        nightKey: "n1",
        action: "published",
        actor: AUTO_GATE_ACTOR,
        reasons: [],
        sources: [],
        at: hoursAgo(1),
      },
      {
        eventId: id,
        nightKey: "n2",
        action: "published",
        actor: AUTO_GATE_ACTOR,
        reasons: [],
        sources: [],
        at: hoursAgo(30),
      },
      {
        eventId: id,
        nightKey: "n3",
        action: "published",
        actor: "lead",
        reasons: [],
        sources: [],
        at: hoursAgo(1),
      },
      {
        eventId: id,
        nightKey: "n4",
        action: "updated",
        actor: AUTO_GATE_ACTOR,
        reasons: [],
        sources: [],
        at: hoursAgo(1),
      },
    ]);
    await expect(countAutoPublished(db, since)).resolves.toBe(1);
  });

  it("loads published (with event title, date, city), held/rejected, re-verification and leads", async () => {
    const id = await event("Ritviz Live");
    await db.insert(publishAudit).values([
      {
        eventId: id,
        nightKey: "n1",
        action: "published",
        actor: AUTO_GATE_ACTOR,
        reasons: [],
        sources: [source],
        at: hoursAgo(2),
      },
      {
        eventId: id,
        nightKey: "n1",
        action: "updated",
        actor: AUTO_GATE_ACTOR,
        reasons: ["venue changed"],
        sources: [],
        changes: { venue: { from: "A", to: "B" } },
        at: hoursAgo(1),
      },
      {
        eventId: null,
        nightKey: "gone|2026-12-01|delhi",
        action: "held",
        actor: AUTO_GATE_ACTOR,
        reasons: ["source gone"],
        sources: [],
        at: hoursAgo(1),
      },
    ]);
    await db.insert(gateDecisions).values([
      {
        nightKey: "h1",
        title: "Held Night",
        night: "2026-12-06",
        city: "Mumbai",
        headliner: "X",
        decision: "hold",
        reasons: ["one source"],
        checks: {},
        sources: [source],
        confidence: 0.6,
        decidedAt: hoursAgo(3),
      },
      {
        nightKey: "p1",
        title: "Passed",
        night: "2026-12-07",
        city: "Goa",
        headliner: "Y",
        decision: "publish",
        reasons: [],
        checks: {},
        sources: [],
        confidence: 0.95,
        decidedAt: hoursAgo(3),
      },
      {
        nightKey: "old",
        title: "Old Hold",
        night: "2026-12-08",
        city: "Goa",
        headliner: "Z",
        decision: "reject",
        reasons: ["past"],
        checks: {},
        sources: [],
        confidence: 0.1,
        decidedAt: hoursAgo(48),
      },
    ]);
    await db.insert(gigLeads).values([
      {
        artist: "Ritviz",
        url: "https://insider.in/x",
        domain: "insider.in",
        title: "t",
        reason: "denied_domain",
        firstSeenAt: hoursAgo(5),
      },
      {
        artist: "Old",
        url: "https://old.in/x",
        domain: "old.in",
        title: "t",
        reason: "unknown_domain",
        firstSeenAt: hoursAgo(50),
      },
    ]);

    const a = await loadGigActivity(db, since);
    expect(a.published).toEqual([
      { title: "Ritviz Live", night: "2026-12-05", city: "Pune", sources: [source] },
    ]);
    expect(a.heldOrRejected.map((h) => [h.title, h.decision, h.reasons])).toEqual([
      ["Held Night", "hold", ["one source"]],
    ]);
    expect(a.reverified).toEqual(
      expect.arrayContaining([
        {
          title: "Ritviz Live",
          action: "updated",
          reasons: ["venue changed"],
          changes: { venue: { from: "A", to: "B" } },
        },
        { title: "gone|2026-12-01|delhi", action: "held", reasons: ["source gone"], changes: null },
      ]),
    );
    expect(a.newLeads.map((l) => l.artist)).toEqual(["Ritviz"]);
  });

  it("tolerates malformed JSON columns", async () => {
    await db.insert(gateDecisions).values({
      nightKey: "bad",
      title: "Bad",
      night: "2026-12-06",
      city: "Pune",
      headliner: "X",
      decision: "reject",
      reasons: "not an array",
      checks: {},
      sources: { nope: true },
      confidence: 0,
      decidedAt: hoursAgo(1),
    });
    const a = await loadGigActivity(db, since);
    expect(a.heldOrRejected[0]).toMatchObject({ reasons: [], sources: [] });
  });
});

/** D-091 on Postgres: the picture facts, the no_image hold flag, posters and listings. */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { artists, eventArtists, events } from "@/db/schema";
import { checkPublishVisual } from "@/domain/events/publish-visual";
import { asEventId, type EventId } from "@/domain/shared/ids";
import { testDb } from "../../../tests/setup/db";
import { PgEventRepository } from "./event-repository";
import { PgEventVerificationRepository } from "./event-verification-repository";
import { truncateEventTables } from "./events-test-db";

const db = testDb();
afterAll(() => db.$close());
beforeEach(() => truncateEventTables(db));

const repo = new PgEventRepository(db);
const store = new PgEventVerificationRepository(db);
const now = new Date("2026-11-22T00:00:00Z");
const photo = "https://i.scdn.co/image/a.jpg";

async function event(
  title: string,
  lineup: {
    name: string;
    tier: "headliner" | "sub" | "mid" | "support";
    image?: string | null;
    alt?: string | null;
  }[],
  over: Partial<typeof events.$inferInsert> = {},
): Promise<EventId> {
  const [e] = await db
    .insert(events)
    .values({
      title,
      type: "concert",
      startsAt: new Date("2026-12-12T14:00:00Z"),
      dedupeKey: title,
      ...over,
    })
    .returning({ id: events.id });
  let rank = 1;
  for (const a of lineup) {
    const [artist] = await db
      .insert(artists)
      .values({
        name: a.name,
        normalizedName: a.name.toLowerCase(),
        imageUrl: a.image ?? null,
        altImageUrl: a.alt ?? null,
      })
      .returning({ id: artists.id });
    await db
      .insert(eventArtists)
      .values({ eventId: e!.id, artistId: artist!.id, billingRank: rank++, tier: a.tier });
  }
  return asEventId(e!.id);
}

const verified = {
  checkedAt: "2026-11-21",
  fields: {},
  checks: [],
  flags: ["single_source"],
  independentSources: 2,
  confidence: 0.95,
  passes: true,
};

describe("event visuals (D-091)", () => {
  it.each<[string, Parameters<typeof event>[1], boolean]>([
    [
      "headliner tier with a Spotify photo",
      [
        { name: "A", tier: "headliner", image: photo },
        { name: "B", tier: "mid" },
      ],
      true,
    ],
    [
      "headliner tier with only an alternative photo",
      [{ name: "A", tier: "headliner", alt: photo }],
      true,
    ],
    [
      "only a support act has a photo",
      [
        { name: "A", tier: "headliner" },
        { name: "B", tier: "support", image: photo },
      ],
      false,
    ],
    [
      "no headliner tier: the top-billed act counts",
      [
        { name: "A", tier: "mid", image: photo },
        { name: "B", tier: "mid" },
      ],
      true,
    ],
    [
      "no headliner tier: a lower act doesn't",
      [
        { name: "A", tier: "mid" },
        { name: "B", tier: "mid", image: photo },
      ],
      false,
    ],
    ["no lineup", [], false],
  ])("%s → publishable: %s", async (_label, lineup, ok) => {
    const id = await event("Night", lineup);
    expect(checkPublishVisual(await repo.visualOf(id)).ok).toBe(ok);
    expect(checkPublishVisual(await store.visualOf(id)).ok).toBe(ok);
  });

  it("a poster is enough; setPoster records it as an admin choice", async () => {
    const id = await event("Night", [{ name: "A", tier: "headliner" }]);
    expect(await repo.setPoster(id, "https://sunburn.in/p.jpg")).toBe(true);
    expect(await repo.visualOf(id)).toEqual({
      posterUrl: "https://sunburn.in/p.jpg",
      headliners: [{ imageUrl: null, altImageUrl: null }],
    });
    const [row] = await db.select({ s: events.posterSource }).from(events).where(eq(events.id, id));
    expect(row!.s).toBe("admin");
    expect(await repo.setPoster(asEventId("00000000-0000-4000-8000-000000000000"), null)).toBe(
      false,
    );
    expect(await repo.visualOf(asEventId("00000000-0000-4000-8000-000000000000"))).toBeNull();
  });

  it("listVisuals: upcoming events of one visibility, soonest first", async () => {
    const later = await event("Later", [], {
      visibility: "published",
      startsAt: new Date("2027-01-01T00:00:00Z"),
    });
    const sooner = await event("Sooner", [], { visibility: "published" });
    await event("Held", [], { visibility: "held" });
    await event("Past", [], {
      visibility: "published",
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect((await repo.listVisuals("published", now, 10)).map((r) => r.id)).toEqual([
      sooner,
      later,
    ]);
  });
});

describe("no_image hold flag (D-091)", () => {
  it("is added once, listed for upcoming held events, and cleared without touching other flags", async () => {
    const id = await event("Night", [], { verification: verified });
    await store.setImageHold(id, true);
    await store.setImageHold(id, true);
    const flags = async () =>
      (
        (await db.select({ v: events.verification }).from(events).where(eq(events.id, id)))[0]!
          .v as { flags: string[] }
      ).flags;
    expect((await flags()).sort()).toEqual(["no_image", "single_source"]);
    expect(await store.listImageHolds(now, 10)).toEqual([id]);

    await store.setImageHold(id, false);
    expect(await flags()).toEqual(["single_source"]);
    expect(await store.listImageHolds(now, 10)).toEqual([]);
  });

  it("survives re-verification, which rewrites the verification object", async () => {
    const id = await event("Night", [], { verification: verified });
    await store.setImageHold(id, true);
    await store.save(id, { ...verified, flags: ["venue_unknown"], confidence: 0.9 } as never, now);
    expect(await store.listImageHolds(now, 10)).toEqual([id]);
    const [row] = await db
      .select({ v: events.verification, c: events.confidence })
      .from(events)
      .where(eq(events.id, id));
    expect((row!.v as { flags: string[] }).flags.sort()).toEqual(["no_image", "venue_unknown"]);
    expect(row!.c).toBeCloseTo(0.9);
    // Without a hold, save writes exactly what it's given.
    const other = await event("Other", [], { verification: verified });
    await store.save(other, { ...verified, flags: [] } as never, now);
    expect(
      (
        (await db.select({ v: events.verification }).from(events).where(eq(events.id, other)))[0]!
          .v as { flags: string[] }
      ).flags,
    ).toEqual([]);
  });

  it("never lists published, past or never-verified events", async () => {
    const published = await event("Pub", [], {
      verification: { ...verified, flags: ["no_image"] },
      visibility: "published",
    });
    const past = await event("Past", [], {
      verification: { ...verified, flags: ["no_image"] },
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const unverified = await event("Raw", []);
    await store.setImageHold(unverified, true);
    expect(await store.listImageHolds(now, 10)).toEqual([]);
    const [raw] = await db
      .select({ v: events.verification })
      .from(events)
      .where(eq(events.id, unverified));
    expect(raw!.v).toBeNull();
    void published;
    void past;
    expect((await db.execute(sql`select count(*)::int as n from events`))[0]).toEqual({ n: 3 });
  });
});

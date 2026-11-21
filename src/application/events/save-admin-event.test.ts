import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { asEventId } from "@/domain/shared/ids";
import {
  AdminEventInputSchema,
  AdminEventPatchSchema,
  createAdminEvent,
  updateAdminEvent,
} from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

const validBody = {
  title: "Zomaland 2026",
  type: "festival",
  startsAt: "2026-02-14T16:00:00+05:30",
  venue: { name: "Jawaharlal Nehru Stadium", city: "New Delhi", country: "in" },
  lineup: [
    { name: "Divine", tier: "headliner" },
    { name: "Seedhe Maut", tier: "sub", day: 2, stage: "Main" },
  ],
};

const parse = (body: unknown) => AdminEventInputSchema.safeParse(body);

describe("AdminEventInputSchema", () => {
  it("parses dates, defaults ranks to list position and upper-cases the country", () => {
    const r = parse(validBody);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({
      status: "announced",
      startsAt: new Date("2026-02-14T10:30:00Z"),
      endsAt: null,
      venue: { country: "IN" },
      lineup: [
        { name: "Divine", billingRank: 1 },
        { name: "Seedhe Maut", billingRank: 2, day: 2, stage: "Main" },
      ],
    });
  });

  const many = Array.from({ length: 301 }, (_, i) => ({ name: `Artist ${i}`, tier: "support" }));

  it.each<[string, Record<string, unknown>]>([
    ["empty lineup", { lineup: [] }],
    ["more than 300 artists", { lineup: many }],
    [
      "duplicate ranks",
      {
        lineup: [
          { name: "A", tier: "headliner", billingRank: 1 },
          { name: "B", tier: "sub", billingRank: 1 },
        ],
      },
    ],
    [
      "rank colliding with a default position",
      {
        lineup: [
          { name: "A", tier: "sub" },
          { name: "B", tier: "sub", billingRank: 1 },
        ],
      },
    ],
    ["unknown tier", { lineup: [{ name: "A", tier: "legend" }] }],
    ["zero rank", { lineup: [{ name: "A", tier: "sub", billingRank: 0 }] }],
    ["non-ISO date", { startsAt: "14/02/2026" }],
    ["date without offset", { startsAt: "2026-02-14T16:00:00" }],
    ["end before start", { endsAt: "2026-02-13T16:00:00Z" }],
    ["bad type", { type: "party" }],
    ["three-letter country", { venue: { name: "X", city: "Delhi", country: "IND" } }],
    ["blank title", { title: "   " }],
    ["unknown top-level key (D-018)", { lineupHash: "x" }],
    ["javascript: url (QA-E-2)", { url: "javascript:alert(document.cookie)" }],
    ["data: imageUrl", { imageUrl: "data:image/svg+xml,<svg onload=alert(1)>" }],
    [
      "151 b2b credits = 302 artists",
      {
        lineup: Array.from({ length: 151 }, (_, i) => ({ name: `A${i} b2b B${i}`, tier: "mid" })),
      },
    ],
    ["unknown venue key", { venue: { ...validBody.venue, id: "v1" } }],
    ["unknown lineup key", { lineup: [{ name: "A", tier: "sub", artistId: "a1" }] }],
  ])("rejects %s", (_label, change) => {
    expect(parse({ ...validBody, ...change }).success).toBe(false);
  });

  it("accepts 150 b2b credits (300 artists after splitting)", () => {
    const lineup = Array.from({ length: 150 }, (_, i) => ({
      name: `A${i} b2b B${i}`,
      tier: "mid",
    }));
    expect(parse({ ...validBody, lineup }).success).toBe(true);
  });

  it("patch rejects non-http(s) links (QA-E-2)", () => {
    expect(AdminEventPatchSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(AdminEventPatchSchema.safeParse({ imageUrl: "data:,x" }).success).toBe(false);
    expect(AdminEventPatchSchema.safeParse({ url: "https://insider.in/e" }).success).toBe(true);
  });

  it("patch rejects unknown keys (D-018)", () => {
    expect(AdminEventPatchSchema.safeParse({ dedupeKey: "x" }).success).toBe(false);
    expect(AdminEventPatchSchema.safeParse({ status: "cancelled" }).success).toBe(true);
  });

  it("accepts exactly 300 artists", () => {
    expect(parse({ ...validBody, lineup: many.slice(0, 300) }).success).toBe(true);
  });
});

describe("createAdminEvent / updateAdminEvent", () => {
  const input = () => AdminEventInputSchema.parse(validBody);

  it("creates the event with an admin source and returns its detail", async () => {
    const world = fakeEventsWorld();
    const { event, outcome } = await createAdminEvent(world, input());
    expect(outcome).toBe("created");
    expect(event).toMatchObject({
      title: "Zomaland 2026",
      venue: { name: "Jawaharlal Nehru Stadium", city: "Delhi", country: "IN" },
      artistCount: 2,
      lineup: [
        { name: "Divine", tier: "headliner", billingRank: 1, matchStatus: "pending" },
        { name: "Seedhe Maut", tier: "sub", billingRank: 2, day: 2, stage: "Main" },
      ],
      sources: [{ source: "admin", externalId: event.id }],
    });
  });

  it("merges into an existing matching event instead of duplicating it", async () => {
    const world = fakeEventsWorld();
    const first = await createAdminEvent(world, input());
    const again = await createAdminEvent(world, { ...input(), title: "Zomaland" });
    expect(again.outcome).toBe("merged");
    expect(again.event.id).toBe(first.event.id);
    expect(again.event.title).toBe("Zomaland");
    expect(world.events.events).toHaveLength(1);
  });

  it("patches only given fields and keeps the lineup when none is sent", async () => {
    const world = fakeEventsWorld();
    const { event } = await createAdminEvent(world, input());
    const patch = AdminEventPatchSchema.parse({ status: "full_lineup", genre: "Hip-hop" });
    const updated = await updateAdminEvent(world, event.id, patch);
    expect(updated.outcome).toBe("updated");
    expect(updated.event).toMatchObject({
      title: "Zomaland 2026",
      status: "full_lineup",
      genre: "Hip-hop",
      lineupHash: event.lineupHash,
    });
  });

  it("replaces the lineup and venue when sent, changing the lineup hash", async () => {
    const world = fakeEventsWorld();
    const { event } = await createAdminEvent(world, input());
    const patch = AdminEventPatchSchema.parse({
      venue: { name: "Huda Grounds", city: "Gurgaon", country: "IN" },
      lineup: [{ name: "Seedhe Maut", tier: "headliner" }],
    });
    const updated = await updateAdminEvent(world, event.id, patch);
    expect(updated.event.venue).toMatchObject({ name: "Huda Grounds", city: "Gurugram" });
    expect(updated.event.lineup.map((a) => a.name)).toEqual(["Seedhe Maut"]);
    expect(updated.event.lineupHash).not.toBe(event.lineupHash);
  });

  it("clears a nullable field when sent null", async () => {
    const world = fakeEventsWorld();
    const { event } = await createAdminEvent(world, { ...input(), genre: "Hip-hop" });
    const updated = await updateAdminEvent(
      world,
      event.id,
      AdminEventPatchSchema.parse({ genre: null }),
    );
    expect(updated.event.genre).toBeNull();
  });

  it("rejects a patch that moves the start after the stored end", async () => {
    const world = fakeEventsWorld();
    const { event } = await createAdminEvent(world, {
      ...input(),
      endsAt: new Date("2026-02-15T18:00:00Z"),
    });
    const patch = AdminEventPatchSchema.parse({ startsAt: "2026-02-16T10:00:00Z" });
    await expect(updateAdminEvent(world, event.id, patch)).rejects.toThrow(ValidationError);
  });

  it("404s an unknown event", async () => {
    const world = fakeEventsWorld();
    await expect(
      updateAdminEvent(world, asEventId("00000000-0000-4000-8000-ffffffffffff"), {}),
    ).rejects.toThrow(NotFoundError);
  });

  it("409s when an edit collides with another event's title, date and city", async () => {
    const world = fakeEventsWorld();
    await createAdminEvent(world, input());
    const other = await createAdminEvent(world, {
      ...input(),
      title: "Comedy Premier League",
      venue: { name: "Siri Fort Auditorium", city: "Delhi", country: "IN" },
      lineup: [{ name: "Zakir Khan", tier: "headliner", billingRank: 1 }],
    });
    expect(other.outcome).toBe("created");
    const patch = AdminEventPatchSchema.parse({ title: "Zomaland 2026" });
    await expect(updateAdminEvent(world, other.event.id, patch)).rejects.toThrow(ConflictError);
  });
});

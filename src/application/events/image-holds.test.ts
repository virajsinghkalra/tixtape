/** D-091: the daily retry of events held for a missing picture, and the "needs image" list. */
import { describe, expect, it, vi } from "vitest";
import type { EventVisual } from "@/domain/events/publish-visual";
import type { EventId } from "@/domain/shared/ids";
import { listNeedingImage, retryImageHolds } from "./image-holds";
import { AdminEventInputSchema, createAdminEvent } from "./save-admin-event";
import { fakeEventsWorld } from "./testing/fakes";

const now = new Date("2026-11-22T06:00:00Z");
const photo = "https://i.scdn.co/image/abc.jpg";

/** A verification store with per-event visuals and holds. */
function store(visuals: Record<string, EventVisual | null>) {
  const visibility = new Map<string, string>();
  const holds = new Set(Object.keys(visuals));
  return {
    visibility,
    holds,
    visuals,
    async listImageHolds() {
      return [...holds] as EventId[];
    },
    async visualOf(id: EventId) {
      return visuals[id] ?? null;
    },
    async setVisibility(id: EventId, v: "held" | "published" | "archived") {
      visibility.set(id, v);
    },
    async setImageHold(id: EventId, held: boolean) {
      if (held) holds.add(id);
      else holds.delete(id);
    },
  };
}

describe("retryImageHolds (D-091)", () => {
  const none = { posterUrl: null, headliners: [{ imageUrl: null, altImageUrl: null }] };

  it("runs the providers for a held event and publishes it once a picture exists", async () => {
    const s = store({ e1: none });
    const fillForEvent = vi.fn(async (id: EventId) => {
      s.visuals[id] = { posterUrl: "https://sunburn.in/poster.jpg", headliners: [] };
    });
    const results = await retryImageHolds({
      store: s,
      fillForEvent,
      clock: { now: () => now },
      logger: { warn: vi.fn() },
    });
    expect(fillForEvent).toHaveBeenCalledWith("e1");
    expect(results).toEqual([{ eventId: "e1", result: { published: true, via: "poster" } }]);
    expect(s.visibility.get("e1")).toBe("published");
    expect(s.holds.size).toBe(0);
  });

  it("skips the search when a Spotify match already brought a photo", async () => {
    const s = store({
      e1: { posterUrl: null, headliners: [{ imageUrl: photo, altImageUrl: null }] },
    });
    const fillForEvent = vi.fn();
    const [r] = await retryImageHolds({
      store: s,
      fillForEvent,
      clock: { now: () => now },
      logger: { warn: vi.fn() },
    });
    expect(fillForEvent).not.toHaveBeenCalled();
    expect(r!.result).toEqual({ published: true, via: "headliner_photo" });
  });

  it("keeps it held when nothing is found, and survives a provider failure", async () => {
    const s = store({ e1: none, e2: none });
    const logger = { warn: vi.fn() };
    const fillForEvent = vi.fn(async (id: EventId) => {
      if (id === "e1") throw new Error("wikimedia down");
    });
    const results = await retryImageHolds({
      store: s,
      fillForEvent,
      clock: { now: () => now },
      logger,
    });
    expect(results).toEqual([
      { eventId: "e1", result: { error: "wikimedia down" } },
      { eventId: "e2", result: { published: false, reason: "no_image" } },
    ]);
    expect(s.visibility.size).toBe(0);
    expect([...s.holds].sort()).toEqual(["e1", "e2"]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});

describe("listNeedingImage (D-091)", () => {
  it("lists published events without a picture, and never unpublishes them", async () => {
    const world = fakeEventsWorld(now);
    const deps = { ...world, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const make = (title: string, posterUrl?: string) =>
      createAdminEvent(
        deps,
        AdminEventInputSchema.parse({
          title,
          type: "concert",
          startsAt: "2026-12-12T14:00:00Z",
          venue: { name: `${title} Hall`, city: "Pune", country: "IN" },
          lineup: [{ name: `${title} Band`, tier: "headliner" }],
          ...(posterUrl ? { posterUrl } : {}),
        }),
      );
    const bare = await make("Bare Night");
    const withPoster = await make("Poster Night", "https://example.org/p.jpg");
    // Published earlier, before the rule existed.
    await world.events.setVisibility(bare.event.id, "published");
    await world.events.setVisibility(withPoster.event.id, "published");
    const rows = await listNeedingImage(world.events, now);
    expect(rows.map((r) => r.title)).toEqual(["Bare Night"]);
    expect(world.events.events.find((e) => e.id === bare.event.id)!.visibility).toBe("published");
  });
});

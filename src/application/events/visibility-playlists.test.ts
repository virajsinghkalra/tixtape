/**
 * D-056 across the team boundary: the Playlist Engine reads events through our `getEvent`,
 * so a held or archived event has no playlist (GET status and POST start both 404).
 */
import { describe, expect, it, vi } from "vitest";
import { getSharedStatus, startSharedBuild } from "@/application/playlists/shared-builds";
import type { EventVisibility } from "@/domain/events/visibility";
import { NotFoundError } from "@/lib/errors";
import { createEventsUseCases } from "./index";
import { fakeEventsWorld } from "./testing/fakes";

async function eventWith(visibility: EventVisibility) {
  const world = fakeEventsWorld();
  const useCases = createEventsUseCases({
    ...world,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const { event } = await useCases.createAdminEvent({
    title: "NH7 Weekender",
    type: "festival",
    status: "announced",
    startsAt: new Date("2026-12-12T10:00:00Z"),
    endsAt: null,
    genre: null,
    imageUrl: null,
    url: null,
    venue: { name: "Lawns", city: "Pune", country: "IN" },
    lineup: [{ name: "Ritviz", tier: "headliner", billingRank: 1 }],
    visibility,
  });
  const unreachable = () => {
    throw new Error("must not get past the event lookup");
  };
  const deps = {
    events: useCases,
    shared: { findByEvent: vi.fn(async () => null) },
    jobs: { findActiveShared: vi.fn(async () => null) },
  };
  return { id: event.id, deps, unreachable };
}

describe("playlists only exist for published events (D-056)", () => {
  it.each(["held", "archived"] as const)("%s: status and start are 404", async (visibility) => {
    const { id, deps, unreachable } = await eventWith(visibility);
    await expect(getSharedStatus(deps as never, id)).rejects.toThrow(NotFoundError);
    await expect(
      startSharedBuild(
        new Proxy(deps, {
          get: (t, k) => (k in t ? t[k as keyof typeof t] : unreachable),
        }) as never,
        id,
        "ip",
      ),
    ).rejects.toThrow(NotFoundError);
    expect(deps.shared.findByEvent).not.toHaveBeenCalled();
  });

  it("published: status reads through to the playlist store", async () => {
    const { id, deps } = await eventWith("published");
    expect(await getSharedStatus(deps as never, id)).toEqual({ status: "none" });
    expect(deps.shared.findByEvent).toHaveBeenCalledWith(id);
  });
});

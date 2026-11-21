import { describe, expect, it, vi } from "vitest";
import { asEventId } from "@/domain/shared/ids";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import {
  recordEventView,
  recordPlaylistOpen,
  recordSearchClick,
  SearchClickSchema,
  type EngagementDeps,
} from "./engagement";
import { CountingLimiter, FakeEngagement, FakeSearchLog } from "./testing/fakes";

const now = new Date("2026-11-25T06:00:00Z");
const E1 = "6f1c2c1e-6a0e-4d1b-9a43-1c7a7c4c1d10";

function setup(clientLimit = 60) {
  const engagement = new FakeEngagement((id) => (id === E1 ? "published" : null));
  const searchLog = new FakeSearchLog();
  const logger = { warn: vi.fn() };
  const deps: EngagementDeps = {
    engagement,
    searchLog,
    clientLimiter: new CountingLimiter(clientLimit),
    repeatLimiter: new CountingLimiter(1),
    clock: { now: () => now },
    logger,
  };
  return { deps, engagement, searchLog, logger };
}

describe("engagement", () => {
  it.each([
    ["view", recordEventView],
    ["playlist_open", recordPlaylistOpen],
  ] as const)(
    "%s bumps once per client and event; repeats are accepted but not counted",
    async (kind, fn) => {
      const { deps, engagement } = setup();
      expect(await fn(deps, asEventId(E1), "1.2.3.4")).toEqual({ counted: true });
      expect(await fn(deps, asEventId(E1), "1.2.3.4")).toEqual({ counted: false });
      expect(await fn(deps, asEventId(E1), "5.6.7.8")).toEqual({ counted: true });
      expect(engagement.recorded.map((r) => r.kind)).toEqual([kind, kind]);
    },
  );

  it("rate-limits a client with 429", async () => {
    const { deps } = setup(2);
    await recordEventView(deps, asEventId(E1), "ip");
    await recordEventView(deps, asEventId(E1), "ip");
    await expect(recordEventView(deps, asEventId(E1), "ip")).rejects.toThrow(RateLimitedError);
  });

  it.each(["held", "archived", null] as const)(
    "a %s event answers 404 every time, never 'accepted' (QA-E-5/6)",
    async (visibility) => {
      const { deps, searchLog } = setup();
      const id = "11111111-1111-4111-8111-111111111111";
      const engagement = new FakeEngagement((x) =>
        x === E1 ? "published" : x === id ? visibility : null,
      );
      deps.engagement = engagement;
      for (let i = 0; i < 2; i++) {
        await expect(recordEventView(deps, asEventId(id), "ip")).rejects.toThrow(NotFoundError);
        await expect(
          recordSearchClick(deps, SearchClickSchema.parse({ q: "x", eventId: id }), "ip"),
        ).rejects.toThrow(NotFoundError);
      }
      expect(engagement.recorded).toEqual([]);
      expect(searchLog.clicks).toEqual([]);
    },
  );

  it("404s an unknown event", async () => {
    const { deps } = setup();
    await expect(
      recordEventView(deps, asEventId("00000000-0000-4000-8000-000000000000"), "ip"),
    ).rejects.toThrow(NotFoundError);
  });

  it("a search click bumps by search_click and logs the normalized query, without the client key", async () => {
    const { deps, engagement, searchLog } = setup();
    await recordSearchClick(
      deps,
      SearchClickSchema.parse({ q: "  Lolla  MUMBAI ", eventId: E1 }),
      "1.2.3.4",
    );
    expect(engagement.recorded).toEqual([{ eventId: E1, kind: "search_click", at: now }]);
    expect(searchLog.clicks).toEqual([{ query: "lolla mumbai", eventId: E1, at: now }]);
    expect(JSON.stringify(searchLog)).not.toContain("1.2.3.4");
  });

  it("a click from a recommendation (no query) only bumps", async () => {
    const { deps, engagement, searchLog } = setup();
    await recordSearchClick(deps, SearchClickSchema.parse({ eventId: E1 }), "ip");
    expect(engagement.recorded).toHaveLength(1);
    expect(searchLog.clicks).toEqual([]);
  });

  it.each([
    [{ q: "x" }],
    [{ q: "x", eventId: "nope" }],
    [{ eventId: E1, userId: "u1" }],
    [{ q: "x".repeat(101), eventId: E1 }],
  ])("click body %j is rejected", (body) => {
    expect(SearchClickSchema.safeParse(body).success).toBe(false);
  });
});

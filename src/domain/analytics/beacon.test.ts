import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENT_NAMES,
  isAnalyticsEventName,
  MAX_EVENTS_PER_BEACON,
  parseBeacon,
  pathGroup,
  scrubQuery,
} from "./beacon";

const DID = "0b0f6a52-8d1e-4a1f-9a77-1d1b7d7e2c11";
const EVENT = "c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3";
const beacon = (ev: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ did: DID, ev, ...extra });

describe("analytics beacon (D-090)", () => {
  it("allow-lists exactly the agreed event names", () => {
    expect(ANALYTICS_EVENT_NAMES.sort()).toEqual(
      [
        "page_view",
        "search",
        "event_open",
        "playlist_make",
        "playlist_open_spotify",
        "share",
        "remind",
        "save",
        "ping_me",
        "follow",
        "city_change",
        "install",
        "story_open",
        "ticket_click",
      ].sort(),
    );
    expect(isAnalyticsEventName("toString")).toBe(false);
    expect(isAnalyticsEventName("__proto__")).toBe(false);
  });

  it("parses a valid batch with a source", () => {
    const b = parseBeacon(
      beacon(
        [
          { n: "page_view", p: { path: "event" } },
          { n: "search", p: { q: "  Diljit  ", results: 3 } },
          { n: "event_open", p: { eventId: EVENT } },
          { n: "install" },
          { n: "share", p: { channel: "native" } },
        ],
        { src: { us: "newsletter", ref: "l.instagram.com", via: "wa" } },
      ),
    );
    expect(b?.ev).toEqual([
      { n: "page_view", p: { path: "event" } },
      { n: "search", p: { q: "Diljit", results: 3 } },
      { n: "event_open", p: { eventId: EVENT } },
      { n: "install", p: {} },
      { n: "share", p: { channel: "native" } },
    ]);
    expect(b?.src?.ref).toBe("l.instagram.com");
  });

  it.each([
    ["unknown name", beacon([{ n: "purchase", p: {} }])],
    ["extra prop key", beacon([{ n: "event_open", p: { eventId: EVENT, email: "a@b.co" } }])],
    ["extra top-level key", beacon([{ n: "install" }], { ip: "1.2.3.4" })],
    ["extra event key", beacon([{ n: "install", t: 1 }])],
    ["raw path instead of group", beacon([{ n: "page_view", p: { path: `/events/${EVENT}` } }])],
    ["non-uuid event id", beacon([{ n: "event_open", p: { eventId: "1 OR 1=1" } }])],
    ["non-uuid device id", JSON.stringify({ did: "abc", ev: [{ n: "install" }] })],
    ["empty batch", beacon([])],
    [
      "too many events",
      beacon(Array.from({ length: MAX_EVENTS_PER_BEACON + 1 }, () => ({ n: "install" }))),
    ],
    ["long query", beacon([{ n: "search", p: { q: "x".repeat(101), results: 0 } }])],
    ["negative results", beacon([{ n: "search", p: { q: "a", results: -1 } }])],
    ["markup in city", beacon([{ n: "city_change", p: { city: "<script>" } }])],
    ["unknown share channel", beacon([{ n: "share", p: { channel: "email" } }])],
    ["not JSON", "{nope"],
    ["empty body", ""],
    ["array body", "[]"],
  ])("rejects %s", (_label, text) => {
    expect(parseBeacon(text)).toBeNull();
  });

  it("caps the body size", () => {
    const big = beacon([{ n: "install" }], { src: { us: "x".repeat(9_000) } });
    expect(parseBeacon(big)).toBeNull();
  });

  it("groups paths and never keeps one", () => {
    expect(pathGroup("/")).toBe("home");
    expect(pathGroup(`/events/${EVENT}`)).toBe("event");
    expect(pathGroup("/search")).toBe("search");
    expect(pathGroup("/privacy")).toBe("privacy");
    expect(pathGroup("/offline")).toBe("offline");
    expect(pathGroup("/design")).toBe("other");
  });

  it("scrubs emails and phone numbers out of queries", () => {
    expect(scrubQuery("me@example.com coldplay")).toBe("[email] coldplay");
    expect(scrubQuery("call +91 98765 43210")).toBe("call [number]");
    expect(scrubQuery("AP Dhillon 2026")).toBe("AP Dhillon 2026");
    expect(scrubQuery("  lots   of   space ")).toBe("lots of space");
  });
});

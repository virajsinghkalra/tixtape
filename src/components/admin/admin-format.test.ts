import { describe, expect, it } from "vitest";
import { formatAgo, formatConfidence, formatIst, isActiveJob } from "./admin-format";
import { toEventForm } from "./event-form";
import { listHref, readEventListParams } from "./event-list-params";
import { asArtistId, asVenueId } from "@/domain/shared/ids";

const now = new Date("2026-11-21T12:00:00Z");

describe("admin formatting", () => {
  it.each([
    ["2026-11-21T11:59:45Z", "just now"],
    ["2026-11-21T11:48:00Z", "12 min ago"],
    ["2026-11-21T09:00:00Z", "3 h ago"],
    ["2026-11-17T12:00:00Z", "4 d ago"],
    ["2026-11-21T12:30:00Z", "in 30 min"],
  ])("formatAgo(%s) is %s", (date, text) => {
    expect(formatAgo(date, now)).toBe(text);
  });

  it("shows times in IST", () => {
    expect(formatIst("2026-12-18T13:30:00Z")).toBe("18 Dec 2026, 19:00 IST");
  });

  it("clamps confidence into 0–100%", () => {
    expect(formatConfidence(0.873)).toBe("87%");
    expect(formatConfidence(1.4)).toBe("100%");
    expect(formatConfidence(-1)).toBe("0%");
  });

  it("knows which jobs are active", () => {
    expect(["queued", "running", "paused"].every((s) => isActiveJob(s as "queued"))).toBe(true);
    expect(isActiveJob("failed")).toBe(false);
    expect(isActiveJob("succeeded")).toBe(false);
  });
});

describe("event list params", () => {
  it("reads valid params and falls back on anything else", () => {
    expect(readEventListParams({ visibility: "held", q: "  sunburn ", page: "3" })).toEqual({
      visibility: "held",
      q: "sunburn",
      page: 3,
    });
    expect(readEventListParams({ visibility: "secret", q: "  ", page: "-2" })).toEqual({
      visibility: null,
      q: null,
      page: 1,
    });
    expect(readEventListParams({ visibility: ["archived", "held"], page: "1.5" })).toEqual({
      visibility: "archived",
      q: null,
      page: 1,
    });
  });

  it("builds the shortest URL", () => {
    expect(listHref({ visibility: null, q: null, page: 1 })).toBe("/admin/events");
    expect(listHref({ visibility: "held", q: "a&b", page: 2 })).toBe(
      "/admin/events?visibility=held&q=a%26b&page=2",
    );
  });
});

describe("toEventForm", () => {
  it("starts from IST dates, the admin link and the lineup in billing order", () => {
    const form = toEventForm({
      startsAt: new Date("2026-12-18T13:30:00Z"),
      endsAt: null,
      venue: { id: asVenueId("v"), name: "Jio World Garden", city: "Mumbai", country: "IN" },
      sources: [
        { source: "sunburn", externalId: "x", url: "https://sunburn.in/", lastSeenAt: now },
        { source: "admin", externalId: "e", url: "https://tickets.example/", lastSeenAt: now },
      ],
      lineup: [
        {
          artistId: asArtistId("b"),
          name: "Anyma",
          billingRank: 2,
          tier: "sub",
          day: null,
          stage: null,
          matchStatus: "auto",
          spotifyId: null,
          imageUrl: null,
        },
        {
          artistId: asArtistId("a"),
          name: "DJ Snake",
          billingRank: 1,
          tier: "headliner",
          day: 1,
          stage: "Main",
          matchStatus: "manual",
          spotifyId: null,
          imageUrl: null,
        },
      ],
    });
    expect(form).toEqual({
      startsAt: "2026-12-18T19:00",
      endsAt: "",
      venue: { name: "Jio World Garden", city: "Mumbai", state: "", country: "IN" },
      url: "https://tickets.example/",
      lineup: [
        { key: "a", name: "DJ Snake", tier: "headliner", day: 1, stage: "Main" },
        { key: "b", name: "Anyma", tier: "sub", day: null, stage: null },
      ],
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  artistHref,
  buildGroups,
  cityHref,
  filterChips,
  flatten,
  ghostCompletion,
  localMatches,
  reasonLabel,
  withoutFilter,
} from "./search-view";
import { EMPTY_RESPONSE, type EventResult } from "./types";

const ev = (title: string, over: Partial<EventResult> = {}): EventResult => ({
  id: title,
  title,
  type: "festival",
  startsAt: "2027-01-23T06:30:00.000Z",
  startsAtDateOnly: false,
  city: "Mumbai",
  venueName: "Racecourse",
  matchReason: "title",
  matchedText: "",
  ...over,
});

describe("buildGroups", () => {
  it("orders Artists, Cities, Events", () => {
    const groups = buildGroups({
      ...EMPTY_RESPONSE,
      results: [ev("Lollapalooza")],
      artists: [{ name: "Olivia Dean", upcomingCount: 1, matchedText: "Oli" }],
      cities: [{ city: "Mumbai", upcomingCount: 2 }],
    });
    expect(groups.map((g) => g.id)).toEqual(["artists", "cities", "events"]);
    expect(flatten(groups).map((o) => o.kind)).toEqual(["artist", "city", "event"]);
  });

  it("keeps fallback events out of the options", () => {
    expect(buildGroups({ ...EMPTY_RESPONSE, fallback: [ev("NH7")] })).toEqual([]);
  });
});

describe("localMatches", () => {
  const sections = [
    {
      id: "up_next" as const,
      title: "Up next",
      items: [ev("Lollapalooza India"), ev("NH7 Weekender")],
    },
  ];
  it("matches recent searches and cached picks by word prefix", () => {
    const groups = localMatches("nh", ["nh7 pune", "diljit"], sections);
    expect(
      flatten(groups).map((o) =>
        o.kind === "query" ? o.query : o.kind === "event" ? o.event.title : "",
      ),
    ).toEqual(["nh7 pune", "NH7 Weekender"]);
  });
  it("needs two characters", () => {
    expect(localMatches("n", ["nh7"], sections)).toEqual([]);
  });
});

describe("ghostCompletion", () => {
  it("completes a strong prefix match", () => {
    expect(ghostCompletion("lolla", ev("Lollapalooza India 2027"))).toBe("palooza India 2027");
  });
  it.each([
    ["not a prefix", "india", ev("Lollapalooza India")],
    ["too short", "l", ev("Lollapalooza")],
    ["no top result", "lol", undefined],
  ])("is empty when %s", (_n, value, top) => {
    expect(ghostCompletion(value, top)).toBe("");
  });
});

describe("filter chips", () => {
  it("labels city, dates, type and genre", () => {
    expect(
      filterChips({
        city: "Pune",
        from: "2026-12-12T00:00:00+05:30",
        to: "2026-12-13T23:59:00+05:30",
        type: "festival",
        genre: "indie",
      }).map((c) => `${c.emoji} ${c.label}`),
    ).toEqual(["📍 Pune", "📅 12 Dec – 13 Dec", "🎪 Festivals", "🎸 indie"]);
  });

  it("removing a chip removes the words that made it", () => {
    expect(withoutFilter("gigs in pune", "city", { city: "Pune" })).toBe("gigs");
    expect(withoutFilter("lolla this weekend", "from", {})).toBe("lolla");
    expect(withoutFilter("festivals mumbai", "type", { type: "festival" })).toBe("mumbai");
  });
});

describe("routing after a click", () => {
  const results = [ev("Lolla", { id: "e1", matchReason: "artist", matchedArtist: "Olivia Dean" })];
  it("an artist with one show opens that event with the artist highlighted", () => {
    expect(artistHref({ name: "Olivia Dean", upcomingCount: 1, matchedText: "" }, results)).toBe(
      "/events/e1?artist=Olivia%20Dean",
    );
  });
  it("an artist with more shows opens their list; a city opens the city list", () => {
    expect(artistHref({ name: "Olivia Dean", upcomingCount: 2, matchedText: "" }, results)).toBe(
      "/search?artist=Olivia%20Dean",
    );
    expect(cityHref("Pune")).toBe("/search?city=Pune");
  });
});

describe("reasonLabel", () => {
  it.each([
    [ev("X", { matchReason: "artist", matchedArtist: "Ritviz" }), "Ritviz plays here"],
    [ev("X", { matchReason: "city" }), "in Mumbai"],
    [ev("X", { matchReason: "venue" }), "at Racecourse"],
    [ev("X", { matchReason: "fuzzy" }), "Close match"],
    [ev("X", { matchReason: "title" }), null],
  ])("%#", (e, label) => {
    expect(reasonLabel(e)).toBe(label);
  });
});

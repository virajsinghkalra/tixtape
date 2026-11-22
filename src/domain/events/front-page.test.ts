import { describe, expect, it } from "vitest";
import {
  buildFrontPage,
  diversify,
  engagementBonus,
  featuredDate,
  groupTours,
  itemKey,
  leadEvent,
  metroOf,
  NEUTRAL_POPULARITY,
  popularityFactor,
  proximity,
  score,
  sizeScore,
  timing,
  titleStem,
  type FeedEvent,
  type FrontItem,
} from "./front-page";

const NOW = new Date("2026-11-21T12:00:00+05:30");
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY);

let seq = 0;
const ev = (over: Partial<FeedEvent> = {}): FeedEvent => ({
  id: `e${++seq}`,
  title: `Gig ${seq}`,
  type: "concert",
  startsAt: inDays(20),
  endsAt: null,
  city: "Mumbai",
  artistCount: 1,
  headliners: [`Artist ${seq}`],
  headlinerListeners: null,
  sourceCount: 1,
  views: 0,
  playlistOpens: 0,
  createdAt: inDays(-10),
  ...over,
});

describe("size", () => {
  it("popularity is log-scaled with no regional bias, and unknown is neutral", () => {
    expect(popularityFactor(null)).toBe(NEUTRAL_POPULARITY);
    expect(popularityFactor(10_000_000)).toBeCloseTo(1, 2);
    expect(popularityFactor(1_000_000)).toBeCloseTo(0.75, 2);
    expect(popularityFactor(100_000)).toBeCloseTo(0.5, 2);
    expect(popularityFactor(100)).toBe(0);
    expect(popularityFactor(1_000)).toBeLessThan(popularityFactor(1_000_000));
    // Arijit (Indian, huge) outranks a small international act.
    expect(sizeScore(ev({ headlinerListeners: 3_000_000 }))).toBeGreaterThan(
      sizeScore(ev({ headlinerListeners: 50_000 })),
    );
  });

  it("festivals, bigger lineups and more sources add size", () => {
    const base = sizeScore(ev());
    expect(sizeScore(ev({ type: "festival" }))).toBeGreaterThan(base);
    expect(sizeScore(ev({ artistCount: 40 }))).toBeGreaterThan(base);
    expect(sizeScore(ev({ sourceCount: 3 }))).toBeGreaterThan(base);
  });

  it("engagement is a small, capped bonus that needs traffic", () => {
    expect(engagementBonus(0, 0)).toBe(0);
    expect(engagementBonus(10, 0)).toBeGreaterThan(0);
    expect(engagementBonus(10_000_000, 1_000_000)).toBe(0.15);
  });
});

describe("proximity", () => {
  it.each([
    ["Mumbai", "Mumbai", 1],
    ["Pune", "Mumbai", 0.7],
    ["Thane", "Mumbai", 0.7],
    ["Gurugram", "Delhi", 0.7],
    ["Kolkata", "Mumbai", 0.3],
    [null, "Mumbai", 0.3],
    ["Kolkata", null, 1],
  ] as const)("%s for a %s visitor → %d", (eventCity, visitor, expected) => {
    expect(proximity(eventCity, visitor)).toBe(expected);
  });

  it("clusters cities into metros", () => {
    expect(metroOf("Secunderabad")).toBe(metroOf("Hyderabad"));
    expect(metroOf("Mohali")).toBe(metroOf("Chandigarh"));
    expect(metroOf("Shillong")).toBe("shillong");
  });
});

describe("timing", () => {
  it.each([
    [2, 1],
    [7, 1],
    [20, 0.9],
    [60, 0.75],
    [120, 0.55],
  ])("%i days away → %d", (days, expected) => {
    expect(timing(inDays(days), null, NOW)).toBe(expected);
  });

  it("past events are never shown; one still running is", () => {
    expect(timing(inDays(-2), null, NOW)).toBeNull();
    expect(timing(inDays(-1), inDays(1), NOW)).toBe(1);
    expect(score(ev({ startsAt: inDays(-3) }), null, NOW)).toBeNull();
  });

  it("a timed show with no end time stays on while it is happening (12 h default)", () => {
    const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    expect(timing(hours(-1), null, NOW)).toBe(1);
    expect(timing(hours(-11), null, NOW)).toBe(1);
    expect(timing(hours(-13), null, NOW)).toBeNull();
  });
});

describe("tours", () => {
  const tour = ["Mumbai", "Pune", "Kolkata", "Chennai"].map((city, i) =>
    ev({
      title: `Martin Garrix India Tour 2027 – ${city}`,
      city,
      headliners: ["Martin Garrix"],
      startsAt: inDays(100 + i * 3),
    }),
  );

  it("takes the title stem", () => {
    expect(titleStem("Martin Garrix India Tour 2027 – Mumbai")).toBe(
      "Martin Garrix India Tour 2027",
    );
  });

  it("groups one card per tour, counting cities", () => {
    const items = groupTours([...tour, ev()], null, NOW);
    const tours = items.filter((i) => i.kind === "tour");
    expect(tours).toHaveLength(1);
    expect(tours[0]!.kind === "tour" && tours[0]!.tour.cityCount).toBe(4);
    expect(items).toHaveLength(2);
  });

  it("features the visitor's city, then their metro, then the next date", () => {
    expect(featuredDate(tour, "Kolkata").city).toBe("Kolkata");
    expect(featuredDate(tour, "Thane").city).toBe("Mumbai");
    expect(featuredDate(tour, null).city).toBe("Mumbai");
  });

  it("joins stops within a year, but not beyond", () => {
    const later = ev({ ...tour[0]!, id: "later", startsAt: inDays(300) });
    expect(groupTours([...tour, later], null, NOW)).toHaveLength(1);
    const far = ev({ ...tour[0]!, id: "far", startsAt: inDays(500) });
    expect(groupTours([...tour, far], null, NOW)).toHaveLength(2);
  });
});

describe("diversify", () => {
  const item = (e: FeedEvent): FrontItem<FeedEvent> => ({ kind: "event", event: e, score: 1 });
  it("allows at most 2 cards per city and per headliner", () => {
    const items = [
      item(ev({ city: "Mumbai" })),
      item(ev({ city: "Mumbai" })),
      item(ev({ city: "Mumbai" })),
      item(ev({ city: "Delhi", headliners: ["Ritviz"] })),
      item(ev({ city: "Chennai", headliners: ["Ritviz"] })),
      item(ev({ city: "Goa", headliners: ["Ritviz"] })),
    ];
    const picked = diversify(items, 10).map((i) => leadEvent(i).city);
    expect(picked).toEqual(["Mumbai", "Mumbai", "Delhi", "Chennai"]);
    // Near you drops the city cap (the city is the point) but keeps the headliner cap.
    expect(diversify(items, 10, { cityCap: false })).toHaveLength(5);
  });
});

describe("seeded scenario: 200 events", () => {
  const cities = [
    "Mumbai",
    "Pune",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Goa",
    "Ahmedabad",
    "Jaipur",
  ];
  const filler = Array.from({ length: 185 }, (_, i) =>
    ev({
      title: `Club night ${i}`,
      city: cities[i % cities.length],
      headliners: [`DJ ${i}`],
      headlinerListeners: 5_000 + (i % 7) * 3_000,
      startsAt: inDays(3 + (i % 150)),
      createdAt: inDays(-60 + (i % 50)),
    }),
  );
  const garrix = [
    "Mumbai",
    "Pune",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Shillong",
    "Bhubaneswar",
  ].map((city, i) =>
    ev({
      id: `garrix-${city}`,
      title: `Martin Garrix India Tour 2027 – ${city}`,
      city,
      headliners: ["Martin Garrix"],
      headlinerListeners: 3_500_000,
      startsAt: inDays(110 + i * 2),
    }),
  );
  const lolla = ev({
    id: "lolla",
    title: "Lollapalooza India 2027",
    type: "festival",
    city: "Mumbai",
    artistCount: 40,
    headliners: ["Olivia Dean", "Limp Bizkit"],
    headlinerListeners: 2_000_000,
    sourceCount: 3,
    startsAt: inDays(120),
  });
  const hornbill = ev({
    id: "hornbill",
    title: "Hornbill Music Festival",
    type: "festival",
    city: "Kohima",
    artistCount: 30,
    headliners: ["Big Act"],
    headlinerListeners: 4_000_000,
    sourceCount: 2,
    startsAt: inDays(15),
  });
  const tiny = ev({
    id: "tiny-kolkata",
    title: "Open mic",
    city: "Kolkata",
    headliners: ["Local band"],
    headlinerListeners: 200,
    startsAt: inDays(4),
  });
  const newest = ev({
    id: "newest",
    title: "Just added gig",
    city: "Goa",
    startsAt: inDays(200),
    createdAt: inDays(0),
  });
  const past = ev({ id: "past", startsAt: inDays(-5) });
  const all = [...filler, ...garrix, lolla, hornbill, tiny, newest, past];

  const ids = (items: FrontItem<FeedEvent>[]) => items.map(itemKey);
  const everything = (page: ReturnType<typeof buildFrontPage<FeedEvent>>) => [
    ...page.nearYou,
    ...page.bigOnes,
    ...page.thisWeek,
    ...page.justAnnounced,
  ];

  it("has 200 events", () => {
    expect(all).toHaveLength(200);
  });

  for (const visitor of ["Mumbai", "Kolkata", null] as const) {
    it(`${visitor ?? "no city"}: the tour is one card, past events never show, no card repeats`, () => {
      const page = buildFrontPage(all, { now: NOW, city: visitor });
      const shown = everything(page);
      expect(shown.filter((i) => i.kind === "event" && i.event.id.startsWith("garrix"))).toEqual(
        [],
      );
      expect(ids(shown)).not.toContain("past");
      expect(new Set(ids(shown)).size).toBe(shown.length);
      expect(
        page.tours.some((t) => t.title === "Martin Garrix India Tour 2027" && t.cityCount === 10),
      ).toBe(true);
      expect(page.bigOnes.length).toBeLessThanOrEqual(5);
    });
  }

  it("Mumbai: Near you is local (Mumbai metro), led by Lollapalooza; far-off festivals still get The big ones", () => {
    const page = buildFrontPage(all, { now: NOW, city: "Mumbai" });
    expect(page.nearYou.length).toBe(6);
    for (const i of page.nearYou) {
      const members = i.kind === "event" ? [i.event] : i.tour.events;
      expect(members.some((e) => ["mumbai"].includes(metroOf(e.city!)))).toBe(true);
    }
    expect(ids(page.nearYou)).toContain("lolla");
    expect(ids(page.bigOnes)).toContain("hornbill");
    const tourCard = [...page.nearYou, ...page.bigOnes].find((i) => i.kind === "tour");
    if (tourCard?.kind === "tour") expect(tourCard.tour.featured.city).toBe("Mumbai");
  });

  it("Kolkata: the tiny local gig is near the visitor; the tour features Kolkata", () => {
    const page = buildFrontPage(all, { now: NOW, city: "Kolkata" });
    expect(ids([...page.nearYou, ...page.thisWeek])).toContain("tiny-kolkata");
    expect(page.tours.find((t) => t.title.startsWith("Martin Garrix"))!.featured.city).toBe(
      "Kolkata",
    );
  });

  it("no city: no Near you; the big ones are India-wide; Just announced leads with the newest", () => {
    const page = buildFrontPage(all, { now: NOW, city: null });
    expect(page.nearYou).toEqual([]);
    expect(ids(page.bigOnes)).toEqual(expect.arrayContaining(["lolla", "hornbill"]));
    expect(ids(page.justAnnounced)[0]).toBe("newest");
    // At most 2 per metro in a section.
    const metros = page.bigOnes.map((i) => metroOf(leadEvent(i).city!));
    for (const m of new Set(metros))
      expect(metros.filter((x) => x === m).length).toBeLessThanOrEqual(2);
  });
});

describe("date-only shows stay on until the end of their IST day", () => {
  // "Shreya Ghoshal – Bengaluru", 22 Nov 2026, date only: stored at 00:00 IST.
  const startsAt = new Date("2026-11-21T18:30:00Z");
  const shreya = ev({ startsAt, startsAtDateOnly: true, city: "Bengaluru" });
  const at00_30 = new Date("2026-11-21T19:00:00Z"); // 22 Nov 00:30 IST
  const at23_30 = new Date("2026-11-22T18:00:00Z"); // 22 Nov 23:30 IST
  const nextDay = new Date("2026-11-22T18:31:00Z"); // 23 Nov 00:01 IST

  it.each([
    ["00:30 IST on the day", at00_30, 1],
    ["23:30 IST on the day", at23_30, 1],
    ["the next day", nextDay, null],
  ])("timing at %s", (_, now, expected) => {
    expect(timing(startsAt, null, now, true)).toBe(expected);
  });

  it("a timed show with no end time stays on for 12 h after it starts, then drops off", () => {
    expect(timing(startsAt, null, at00_30)).toBe(1);
    expect(timing(startsAt, null, new Date(startsAt.getTime() + 13 * 3_600_000))).toBeNull();
  });

  it("is on the home page at 00:30 and 23:30 IST, gone the next day", () => {
    const has = (now: Date) => {
      const page = buildFrontPage([shreya], { now, city: null });
      return [...page.nearYou, ...page.bigOnes, ...page.thisWeek, ...page.justAnnounced].some(
        (i) => i.kind === "event" && i.event.id === shreya.id,
      );
    };
    expect(has(at00_30)).toBe(true);
    expect(has(at23_30)).toBe(true);
    expect(has(nextDay)).toBe(false);
  });
});

describe("a long tour stays one card (Shreya Ghoshal, 14 stops over 4+ months)", () => {
  const cities = [
    "Bengaluru",
    "Hyderabad",
    "Chennai",
    "Pune",
    "Mumbai",
    "Ahmedabad",
    "Jaipur",
    "Delhi NCR",
    "Lucknow",
    "Kolkata",
    "Guwahati",
    "Indore",
    "Kochi",
    "Chandigarh",
  ];
  // 22 Nov 2026 → 3 Apr 2027, roughly every 10 days.
  const stops = cities.map((city, i) =>
    ev({
      title: `Shreya Ghoshal – The Unstoppable India Tour – ${city}`,
      headliners: ["Shreya Ghoshal"],
      city,
      startsAt: new Date(new Date("2026-11-22T14:30:00Z").getTime() + i * 10.85 * DAY),
    }),
  );

  it("groups all 14 stops into one tour and features the visitor's city", () => {
    const items = groupTours(stops, "Kolkata", NOW);
    expect(items).toHaveLength(1);
    const tour = items[0]!;
    expect(tour.kind).toBe("tour");
    if (tour.kind !== "tour") return;
    expect(tour.tour.events).toHaveLength(14);
    expect(tour.tour.cityCount).toBe(14);
    expect(tour.tour.featured.city).toBe("Kolkata");
  });

  it("two different tours by the same artist (different stems) stay separate", () => {
    const other = ev({
      title: "Shreya Ghoshal – All Hearts Tour – Mumbai",
      headliners: ["Shreya Ghoshal"],
      city: "Mumbai",
      startsAt: inDays(40),
    });
    const items = groupTours([...stops, other], null, NOW);
    expect(items).toHaveLength(2);
  });

  it("titles without a stop suffix still use the ~90-day window", () => {
    const night = (d: number) =>
      ev({ title: "Sunburn Arena", headliners: ["DJ Snake"], startsAt: inDays(d) });
    expect(groupTours([night(1), night(200)], null, NOW)).toHaveLength(2);
    expect(groupTours([night(1), night(60)], null, NOW)).toHaveLength(1);
  });
});

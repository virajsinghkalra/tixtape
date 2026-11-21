import { describe, expect, it } from "vitest";
import type { ValidatedCandidate } from "./candidate";
import { reverificationDue, reverifyEveryMs, verifyEvent, type Verification } from "./verify";

const now = new Date("2026-11-21T10:00:00Z");
const lineup = ["DJ Snake", "Sebastian Ingrosso", "The Chainsmokers", "Jason Derulo", "Anyma"];

/** Golden: Sunburn Festival 2026 as the organiser announced it (D-055). */
const sunburnOfficial: ValidatedCandidate = {
  source: "sunburn",
  trust: "official",
  externalId: "post:24000",
  url: "https://sunburn.in/sunburn-festival-2026-lineup/",
  title: "Sunburn Festival 2026",
  type: "festival",
  startsAt: new Date("2026-12-18T00:00:00+05:30"),
  endsAt: new Date("2026-12-19T00:00:00+05:30"),
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: "Mahalaxmi Racecourse",
  artists: lineup,
  supportActs: [],
  confidence: 0.9,
  fingerprint: "text:sunburn",
};
const rsi: ValidatedCandidate = {
  ...sunburnOfficial,
  source: "rollingstone",
  trust: "trusted",
  externalId: "https://rollingstoneindia.com/?p=1",
  url: "https://rollingstoneindia.com/sunburn-2026-lineup/",
  fingerprint: "text:rsi",
};
const c = (over: Partial<ValidatedCandidate>) => ({ ...rsi, ...over });

const failed = (v: Verification) => v.checks.filter((x) => x.ok === false).map((x) => x.name);

describe("verifyEvent", () => {
  it("golden: Sunburn 2026 Mumbai passes when the organiser and a trusted outlet agree", () => {
    const v = verifyEvent([sunburnOfficial, rsi], { now });
    expect(failed(v)).toEqual([]);
    expect(v.passes).toBe(true);
    expect(v.fields.date).toMatchObject({
      value: "2026-12-18/2026-12-19",
      status: "verified",
      independent: 2,
    });
    expect(v.fields.city).toMatchObject({ value: "Mumbai", status: "verified" });
    expect(v.fields.venue).toMatchObject({ value: "Mahalaxmi Racecourse", status: "verified" });
    expect(v.fields.headliners.status).toBe("verified");
    expect(v.fields.headliners.artists.every((a) => a.confirmed)).toBe(true);
    expect(v.fields.date.agreeing.map((a) => a.url)).toEqual([sunburnOfficial.url, rsi.url]);
    expect(v.confidence).toBeGreaterThan(0.8);
  });

  it("syndicated copies of one press release count once", () => {
    const pollstarCopy = c({
      source: "pollstar",
      url: "https://news.pollstar.com/x",
      fingerprint: "text:rsi",
    });
    const v = verifyEvent([rsi, pollstarCopy], { now });
    expect(v.independentSources).toBe(1);
    expect(v.fields.date.status).toBe("single");
    expect(v.passes).toBe(false);
  });

  it("an organiser source alone verifies its own facts (D-056)", () => {
    const v = verifyEvent([sunburnOfficial], { now });
    expect(v.fields.date.status).toBe("official");
    expect(v.fields.headliners.status).toBe("official");
    expect(v.passes).toBe(true);
  });

  it("a single news source does not pass", () => {
    const v = verifyEvent([rsi], { now });
    expect(v.fields.date.status).toBe("single");
    expect(failed(v)).toEqual(
      expect.arrayContaining(["date_agreement", "city_agreement", "headliners"]),
    );
  });

  it("a date disagreement is a conflict and holds the event", () => {
    const v = verifyEvent(
      [sunburnOfficial, c({ startsAt: new Date("2026-12-19T00:00:00+05:30"), endsAt: null })],
      { now },
    );
    expect(v.fields.date.status).toBe("conflict");
    expect(v.fields.date.disagreeing[0]).toMatchObject({
      source: "rollingstone",
      value: "2026-12-19",
    });
    expect(v.passes).toBe(false);
  });

  it("golden: a stale copy of a past edition's lineup is rejected", () => {
    const v = verifyEvent([sunburnOfficial, rsi], { now, pastLineups: [[...lineup]] });
    expect(failed(v)).toContain("not_stale_lineup");
  });

  it("golden: the series running in another city (old Goa edition) is a city conflict", () => {
    const v = verifyEvent([sunburnOfficial, rsi], { now, conflictingCities: ["Goa"] });
    expect(v.fields.city.status).toBe("conflict");
    expect(failed(v)).toEqual(expect.arrayContaining(["city_agreement", "series_city"]));
  });

  it("past, far-future and year-less dates fail layer 1", () => {
    const past = { startsAt: new Date("2025-02-01T00:00:00+05:30"), endsAt: null };
    expect(failed(verifyEvent([{ ...sunburnOfficial, ...past }], { now }))).toContain(
      "date_future",
    );
    const far = { startsAt: new Date("2028-12-01T00:00:00+05:30"), endsAt: null };
    expect(failed(verifyEvent([{ ...sunburnOfficial, ...far }], { now }))).toContain(
      "date_within_18_months",
    );
    expect(failed(verifyEvent([{ ...sunburnOfficial, dateExplicit: false }], { now }))).toContain(
      "date_explicit",
    );
  });

  it("checks headliner activity and the venue's geocoded city when available", () => {
    const identities = new Map([
      ["dj snake", { wikidataId: "Q1", mbid: "m", lastReleaseYear: 2025 }],
      ["sebastian ingrosso", { wikidataId: "Q2", mbid: "m", lastReleaseYear: 2012 }],
    ]);
    const v = verifyEvent([sunburnOfficial, rsi], { now, identities, venueGeoCity: "Pune" });
    expect(failed(v)).toEqual(expect.arrayContaining(["headliners_active", "venue_in_city"]));
    const ok = verifyEvent([sunburnOfficial, rsi], { now, venueGeoCity: "Mumbai" });
    expect(ok.checks.find((x) => x.name === "venue_in_city")?.ok).toBe(true);
    expect(ok.checks.find((x) => x.name === "headliners_active")?.ok).toBeNull();
  });

  it("one article creating many events is held without corroboration", () => {
    const v = verifyEvent([sunburnOfficial], { now, eventsFromSameArticle: 11 });
    expect(failed(v)).toContain("no_source_burst");
  });

  it("artists named by one source only are not confirmed", () => {
    const v = verifyEvent([sunburnOfficial, c({ artists: [...lineup, "Hardwell"] })], { now });
    const hardwell = v.fields.headliners.artists.find((a) => a.name === "Hardwell");
    expect(hardwell).toMatchObject({ confirmed: false, sources: 1 });
    expect(v.passes).toBe(true);
  });

  it("an event with no lineup yet passes only when two independent sources confirm it", () => {
    const noLineup = { artists: [] as string[] };
    expect(verifyEvent([{ ...sunburnOfficial, ...noLineup }], { now }).passes).toBe(false);
    const v = verifyEvent([{ ...sunburnOfficial, ...noLineup }, c(noLineup)], { now });
    expect(v.passes).toBe(true);
    expect(v.flags).toContain("lineup_not_announced");
  });
});

describe("D-060 re-verification cadence", () => {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000);
  it.each([
    [90, 24],
    [61, 24],
    [30, 6],
    [7, 6],
    [6, 3],
    [0, 3],
  ])("%i days out → every %i h", (days, hours) => {
    expect(reverifyEveryMs(at(days), now)).toBe(hours * 3_600_000);
  });

  it("is due when never verified, or when the interval has passed (with a little slack)", () => {
    const start = at(30);
    expect(reverificationDue(start, null, now)).toBe(true);
    expect(reverificationDue(start, new Date(now.getTime() - 3 * 3_600_000), now)).toBe(false);
    expect(
      reverificationDue(start, new Date(now.getTime() - 6 * 3_600_000 + 5 * 60_000), now),
    ).toBe(true);
  });
});

describe("independence", () => {
  it("two items from the same publisher (listing + blog post) count once", () => {
    const listing = {
      ...sunburnOfficial,
      externalId: "event:23439",
      fingerprint: "https://sunburn.in/event/x/",
      artists: [],
    };
    const post = {
      ...sunburnOfficial,
      externalId: "post:23421",
      fingerprint: "text:post",
      artists: [],
    };
    const v = verifyEvent([listing, post], { now });
    expect(v.independentSources).toBe(1);
    expect(v.fields.date.status).toBe("official");
    // No lineup and only one independent source: held.
    expect(v.passes).toBe(false);
  });
});

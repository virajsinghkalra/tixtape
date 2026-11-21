import { describe, expect, it } from "vitest";
import { ogVersion, planOgCard, shortDateRange, titleSizeFor, type OgEventInput } from "./og-card";

const base: OgEventInput = {
  id: "c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3",
  title: "Lollapalooza India 2027",
  startsAt: new Date("2027-01-23T06:30:00Z"),
  endsAt: new Date("2027-01-24T17:30:00Z"),
  city: "Mumbai",
  posterUrl: null,
  playlistLive: false,
  lineup: [
    { name: "Opener", imageUrl: null, tier: "support", billingRank: 9 },
    { name: "Headliner A", imageUrl: "https://i.scdn.co/a.jpg", tier: "headliner", billingRank: 1 },
    {
      name: "Headliner B",
      imageUrl: null,
      altImageUrl: "https://upload.wikimedia.org/b.jpg",
      tier: "headliner",
      billingRank: 2,
    },
  ],
};

describe("shortDateRange", () => {
  it("shows one IST day", () =>
    expect(shortDateRange(new Date("2027-01-23T18:00:00Z"), null)).toBe("23 Jan"));
  it("joins days in one month", () =>
    expect(shortDateRange(base.startsAt, base.endsAt)).toBe("23–24 Jan"));
  it("spans months", () =>
    expect(shortDateRange(new Date("2026-12-31T12:00:00Z"), new Date("2027-01-01T12:00:00Z"))).toBe(
      "31 Dec – 1 Jan",
    ));
  it("treats an end on the same IST day as one day", () =>
    expect(shortDateRange(new Date("2027-01-23T12:00:00Z"), new Date("2027-01-23T17:00:00Z"))).toBe(
      "23 Jan",
    ));
});

describe("planOgCard", () => {
  it("leads with headliners, photos first, and has no song or minute counts (D-082)", () => {
    const plan = planOgCard(base);
    expect(plan.dateLine).toBe("23–24 Jan · Mumbai");
    expect(plan.names).toBe("Headliner A · Headliner B · Opener");
    expect(plan.pictures).toEqual([
      "https://i.scdn.co/a.jpg",
      "https://upload.wikimedia.org/b.jpg",
    ]);
    expect(plan.sticker).toBe("Playlist soon");
    expect(JSON.stringify(plan)).not.toMatch(/\d+\s*(songs|tracks|min)/i);
  });

  it("uses the poster alone when there is one", () =>
    expect(planOgCard({ ...base, posterUrl: "https://x.example/p.jpg" }).pictures).toEqual([
      "https://x.example/p.jpg",
    ]));

  it("is typographic when nobody has a photo", () =>
    expect(planOgCard({ ...base, lineup: [{ name: "Solo", imageUrl: null }] }).pictures).toEqual(
      [],
    ));

  it("says live when the playlist is ready", () =>
    expect(planOgCard({ ...base, playlistLive: true }).sticker).toBe("Playlist live"));

  it("leaves out an unknown city", () =>
    expect(planOgCard({ ...base, city: null }).dateLine).toBe("23–24 Jan"));

  it("caps very long titles", () =>
    expect([...planOgCard({ ...base, title: "x".repeat(200) }).title]).toHaveLength(90));
});

describe("titleSizeFor", () => {
  it("steps down as titles grow", () => {
    expect(titleSizeFor("Anyma")).toBeGreaterThan(titleSizeFor("x".repeat(30)));
    expect(titleSizeFor("x".repeat(30))).toBeGreaterThan(titleSizeFor("x".repeat(80)));
  });
});

describe("ogVersion", () => {
  it("is stable for the same card", () =>
    expect(ogVersion(planOgCard(base))).toBe(ogVersion(planOgCard(base))));
  it("changes when the lineup or playlist state changes", () => {
    const v = ogVersion(planOgCard(base));
    expect(ogVersion(planOgCard({ ...base, playlistLive: true }))).not.toBe(v);
    expect(ogVersion(planOgCard({ ...base, lineup: base.lineup.slice(1) }))).not.toBe(v);
  });
});

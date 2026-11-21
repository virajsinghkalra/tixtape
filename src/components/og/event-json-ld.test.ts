import { describe, expect, it } from "vitest";
import { eventJsonLd, jsonLdScript, shareDescription, type JsonLdEvent } from "./event-json-ld";

const e: JsonLdEvent = {
  title: "Lollapalooza India 2027",
  status: "full_lineup",
  startsAt: new Date("2027-01-23T06:30:00Z"),
  endsAt: new Date("2027-01-24T17:30:00Z"),
  venue: { name: "Mahalaxmi Racecourse", city: "Mumbai" },
  posterUrl: null,
  lineup: [
    { name: "C", imageUrl: null, tier: "support", billingRank: 5 },
    { name: "A", imageUrl: null, tier: "headliner", billingRank: 1 },
    { name: "B", imageUrl: null, tier: "headliner", billingRank: 2 },
    { name: "D", imageUrl: null, tier: "support", billingRank: 6 },
  ],
};

it("describes date, city and top 3 names", () =>
  expect(shareDescription(e)).toBe("23–24 Jan · Mumbai · A, B, C"));

describe("eventJsonLd", () => {
  const ld = eventJsonLd(e, "https://t.example/events/1", "https://t.example/og.jpg");
  it("is a scheduled MusicEvent at a Place", () => {
    expect(ld["@type"]).toBe("MusicEvent");
    expect(ld.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(ld.location?.address.addressLocality).toBe("Mumbai");
    expect(ld.performer.map((p) => p.name)).toEqual(["A", "B", "C", "D"]);
    expect(ld.image).toEqual(["https://t.example/og.jpg"]);
  });
  it("marks cancelled shows and prefers the poster", () => {
    const c = eventJsonLd({ ...e, status: "cancelled", posterUrl: "https://p/x.jpg" }, "u", "i");
    expect(c.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(c.image).toEqual(["https://p/x.jpg"]);
  });
  it("leaves out an unknown venue and end", () => {
    const c = eventJsonLd({ ...e, venue: null, endsAt: null }, "u", "i");
    expect(c).not.toHaveProperty("location");
    expect(c).not.toHaveProperty("endDate");
  });
});

it("can't break out of the script tag", () => {
  const out = jsonLdScript({ name: "</script><script>alert(1)</script> & <!--" });
  expect(out).not.toMatch(/<|>/);
  expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script> & <!--");
});

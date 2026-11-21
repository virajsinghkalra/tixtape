import { describe, expect, it } from "vitest";
import {
  actsFromListingTitle,
  extractArtistGigs,
  gigsFromJsonLd,
  isoDate,
  itemListName,
  jsonLdBlocks,
  jsonLdEvents,
  namesArtist,
  parseJsonLdStart,
  type ExtractContext,
} from "./extract";
import { registrableDomain } from "./registrable-domain";

const now = new Date("2026-11-21T10:00:00Z");
const artistCtx: ExtractContext = {
  now,
  source: "artist_site",
  trust: "official",
  officialKind: "artist",
  via: "artist_site",
};
const outletCtx: ExtractContext = {
  now,
  source: "gig_web",
  trust: "trusted",
  officialKind: null,
  via: "search",
};

describe("extractArtistGigs", () => {
  const page = {
    url: "https://bhuwin.example.com/live",
    title: "Bhuwin · Live",
    text: [
      "Bhuwin",
      "Sketchbook — Unfinished Notes / Loops / Songs",
      "Mumbai | 05th, 06th & 09th December 2026 | 7:30 PM",
      "Indore | 24 December 2026",
      "London | 6 September 2026",
      "Pune | 5th, 6th and 9th December",
    ].join("\n"),
  };

  it("splits a run of listed nights into one candidate per night", () => {
    const found = extractArtistGigs(page, "Bhuwin", artistCtx);
    const mumbai = found.filter((c) => c.city === "Mumbai");
    expect(mumbai.map((c) => isoDate(c.startsAt))).toEqual([
      "2026-12-05",
      "2026-12-06",
      "2026-12-09",
    ]);
    expect(mumbai[0]!.provenance).toMatchObject({
      startTime: "19:30",
      officialKind: "artist",
      runNights: ["2026-12-06", "2026-12-09"],
      dateRange: false,
      quotes: {
        date: "05th, 06th & 09th December 2026",
        time: "7:30 PM",
        headliner: "Bhuwin",
      },
    });
    expect(new Set(found.map((c) => c.externalId)).size).toBe(found.length);
  });

  it("keeps only Indian cities, future dates and explicit years", () => {
    const found = extractArtistGigs(page, "Bhuwin", artistCtx);
    expect(found.map((c) => c.city).sort()).toEqual(["Indore", "Mumbai", "Mumbai", "Mumbai"]);
    // "London" is not an Indian city; "Pune | 5th, 6th and 9th December" has no year.
  });

  it("every quote is a verbatim span of the page text", () => {
    for (const c of extractArtistGigs(page, "Bhuwin", artistCtx)) {
      for (const q of Object.values(c.provenance.quotes)) expect(page.text).toContain(q);
    }
  });

  it("never takes the city from the next show's heading (tour list layout)", () => {
    const tour = {
      url: "https://www.pcrc.in/tour",
      title: "Tour",
      text: [
        "Peter Cat Recording Co. | Bengaluru 2027",
        "9 January 2027",
        "Peter Cat Recording Co. | Guwahati 2027",
        "10 January 2027",
        "Peter Cat Recording Co. | Delhi NCR 2027",
        "31 January 2027",
      ].join("\n"),
    };
    const found = extractArtistGigs(tour, "Peter Cat Recording Co.", artistCtx);
    expect(found.map((c) => `${isoDate(c.startsAt)} ${c.city}`)).toEqual([
      "2027-01-09 Bengaluru",
      "2027-01-31 Delhi",
    ]);
  });

  it("on an outlet page, needs the artist named next to the date", () => {
    const article = {
      url: "https://www.rollingstoneindia.com/x",
      title: "Gig guide",
      text: "Prateek Kuhad plays Mumbai on 12 December 2026.\nAnother act plays Delhi on 13 December 2026.",
    };
    const found = extractArtistGigs(article, "Prateek Kuhad", outletCtx);
    expect(found.map((c) => `${c.city} ${isoDate(c.startsAt)}`)).toEqual(["Mumbai 2026-12-12"]);
  });

  it("marks a listing range as a range, never as nights", () => {
    const listing = { ...page, text: "Bhuwin\nMumbai · Sat 5 Dec 2026 - Wed 9 Dec 2026 · 7:30 PM" };
    const [c] = extractArtistGigs(listing, "Bhuwin", artistCtx);
    expect(c?.provenance.dateRange).toBe(true);
    expect(c?.endsAt).not.toBeNull();
  });

  it("flags cancellations", () => {
    const cancelled = { ...page, text: "Bhuwin\nMumbai | 12 December 2026 — cancelled" };
    expect(extractArtistGigs(cancelled, "Bhuwin", artistCtx)[0]?.cancelled).toBe(true);
  });
});

describe("JSON-LD", () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","name":"Events & Experiences in Mumbai","itemListElement":[{"@type":"ListItem","item":{"@type":"Event","name":"Live Vibes | Nikita performs Saturday","url":"https://www.highape.com/mumbai/events/a","startDate":"2026-12-05T19:30:00+05:30","location":{"@type":"Place","name":"antiSOCIAL Khar","address":{"addressLocality":"Bangalore"}}}},{"@type":"ListItem","item":{"@type":"MusicEvent","name":"Old show","startDate":"2025-01-01T20:00:00+05:30"}}]}</script><script type="application/ld+json">{broken</script>`;

  it("reads Event nodes from item lists and skips malformed blocks", () => {
    const blocks = jsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(itemListName(blocks)).toBe("Events & Experiences in Mumbai");
    expect(jsonLdEvents(blocks).map((e) => e.name)).toEqual([
      "Live Vibes | Nikita performs Saturday",
      "Old show",
    ]);
  });

  it("uses the page's city over a wrong addressLocality and grounds on the JSON values", () => {
    const events = jsonLdEvents(jsonLdBlocks(html));
    const found = gigsFromJsonLd(
      events,
      {
        url: "https://highape.com/mumbai",
        city: "Mumbai",
        cityQuote: "Events & Experiences in Mumbai",
      },
      {
        ...outletCtx,
        source: "highape",
        officialKind: "ticketing",
        via: "listing",
        acts: (e) => actsFromListingTitle(e.name),
      },
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      city: "Mumbai",
      title: "Live Vibes | Nikita performs Saturday",
      artists: [{ name: "Nikita" }],
      provenance: {
        startTime: "19:30",
        dateOnly: false,
        quotes: { date: "2026-12-05T19:30:00+05:30" },
      },
    });
  });

  it.each([
    ["2026-12-05T19:30:00+05:30", "2026-12-05", "19:30"],
    ["2026-12-05", "2026-12-05", null],
    ["2026-12-05T00:00+05:30", "2026-12-05", null],
  ])("parses start %s", (value, night, time) => {
    const r = parseJsonLdStart(value);
    expect(r && isoDate(r.night)).toBe(night);
    expect(r?.time).toBe(time);
  });

  it("refuses starts without a four-digit year or with an impossible date", () => {
    expect(parseJsonLdStart("05-12-26")).toBeNull();
    expect(parseJsonLdStart("2026-02-31")).toBeNull();
  });
});

describe("actsFromListingTitle", () => {
  it.each([
    ["CROSS/OVER Ft Nikhil Chinapa", ["Nikhil Chinapa"]],
    ["War Drum | James Mithal Live at HOD Club", ["James Mithal"]],
    ["Black Friday | Karthik Gopinath live at HOD CLUB", ["Karthik Gopinath"]],
    ["Skandagiri Sunrise Trek By e2e", []],
  ])("%j", (title, names) => {
    expect(actsFromListingTitle(title).map((m) => m.name)).toEqual(names);
  });
});

describe("helpers", () => {
  it("namesArtist matches whole words only", () => {
    expect(namesArtist("Sketchbook by Bhuwin Khursija", "Bhuwin")).toBe(true);
    expect(namesArtist("Bhuwinder live", "Bhuwin")).toBe(false);
  });

  it.each([
    ["https://in.bookmyshow.com/events/x", "bookmyshow.com"],
    ["https://www.highape.com/mumbai", "highape.com"],
    ["https://shop.example.co.in/a", "example.co.in"],
    ["https://localhost/a", "localhost"],
    ["javascript:alert(1)", null],
  ])("registrableDomain(%s) = %s", (url, domain) => {
    expect(registrableDomain(url)).toBe(domain);
  });
});

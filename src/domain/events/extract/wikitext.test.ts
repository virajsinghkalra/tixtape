import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { artistsFromImageName } from "./image-names";
import { decodeEntities, htmlToText } from "./html";
import { extractWikipediaEditions, linkLabels, stripWikiMarkup } from "./wikitext";

const fixture = (name: string) => {
  const path = fileURLToPath(
    new URL(`../../../infrastructure/sources/__fixtures__/wikipedia/${name}`, import.meta.url),
  );
  const parse = JSON.parse(readFileSync(path, "utf8")).parse;
  return {
    pageId: parse.pageid as number,
    title: parse.title as string,
    wikitext: parse.wikitext as string,
  };
};

describe("wikitext helpers", () => {
  it("strips refs and nested templates, keeps links", () => {
    expect(
      stripWikiMarkup("A<ref>{{cite web|x={{y}}}}</ref> [[B|b]]{{c|{{d}}}}'''bold'''<ref name=r/>"),
    ).toBe("A [[B|b]]bold");
  });

  it("reads link labels", () => {
    expect(linkLabels("[[Chet Faker|Nick Murphy]] and [[Opeth]]")).toEqual([
      "Nick Murphy",
      "Opeth",
    ]);
  });
});

describe("extractWikipediaEditions", () => {
  it("reads the current edition's dates, city and lineup (NH7 Weekender 2019)", () => {
    const found = extractWikipediaEditions(
      fixture("NH7_Weekender.json"),
      { eventName: "NH7 Weekender" },
      new Date("2019-10-01T00:00:00Z"),
    );
    // Meghalaya (Jaintia Hills) isn't a city we know, so only the Pune edition is a candidate.
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      externalId: "33852659:2019:pune",
      title: "NH7 Weekender 2019",
      city: "Pune",
      startsAt: new Date("2019-11-29T00:00:00+05:30"),
      endsAt: new Date("2019-12-01T00:00:00+05:30"),
    });
    const names = found[0]!.artists.map((a) => a.name);
    expect(names.slice(0, 3)).toEqual(["Nick Murphy", "Opeth", "Kodaline"]);
    expect(names).toContain("Kokoroko");
    expect(found[0]!.artists.find((a) => a.name === "Kavya x Chaz")?.parts).toEqual([
      { name: "Kavya", parts: [] },
      { name: "Chaz", parts: [] },
    ]);
  });

  it("ignores past editions", () => {
    const found = extractWikipediaEditions(
      fixture("NH7_Weekender.json"),
      { eventName: "NH7 Weekender" },
      new Date("2026-11-21T00:00:00Z"),
    );
    expect(found).toEqual([]);
  });

  it("an article without a current-edition section contributes nothing (Lollapalooza India)", () => {
    expect(
      extractWikipediaEditions(
        fixture("Lollapalooza.json"),
        { eventName: "Lollapalooza India" },
        new Date("2026-11-21T10:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("reads an explicit current-edition section with dates inside its year", () => {
    const wikitext = [
      "{{Infobox music festival|name=Example Fest}}",
      "== History ==",
      "The 2019 edition was held on 1 December in [[Pune]] with [[Opeth]].",
      "=== 2026 ===",
      "The 2026 edition takes place in [[Mumbai]] on 18–19 December at [[Mahalaxmi Racecourse]]. Headliners include [[DJ Snake]] and [[Anyma]].",
    ].join("\n");
    const found = extractWikipediaEditions(
      { pageId: 9, title: "Example Fest", wikitext },
      { eventName: "Example Fest" },
      new Date("2026-11-21T10:00:00Z"),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      title: "Example Fest 2026",
      city: "Mumbai",
      venueName: "Mahalaxmi Racecourse",
      startsAt: new Date("2026-12-18T00:00:00+05:30"),
      dateExplicit: true,
    });
    expect(found[0]!.artists.map((a) => a.name)).toEqual(["DJ Snake", "Anyma"]);
  });
});

/**
 * Golden regressions (D-054, D-055): the exact real pages behind two wrong publishes.
 * Both were extracted by the pre-fix code into upcoming events; these must stay empty.
 */
describe("golden: real Wikipedia pages that were published wrongly", () => {
  const now = new Date("2026-11-21T10:00:00Z");

  it("Ed Sheeran's +−=÷× Tour India leg is 2025, never an upcoming 2027 show", () => {
    expect(
      extractWikipediaEditions(fixture("Mathematics_Tour.json"), { eventName: "+−=÷× Tour" }, now),
    ).toEqual([]);
  });

  it("…and read in its own time, the headliner is Ed Sheeran with the opener as support", () => {
    const found = extractWikipediaEditions(
      fixture("Mathematics_Tour.json"),
      { eventName: "+−=÷× Tour" },
      new Date("2025-01-01T00:00:00Z"),
    );
    expect(found.map((c) => [c.city, c.startsAt.toISOString().slice(0, 10)])).toEqual([
      ["Pune", "2025-01-29"],
      ["Hyderabad", "2025-02-01"],
      ["Chennai", "2025-02-04"],
      ["Bengaluru", "2025-02-07"],
      ["Bengaluru", "2025-02-08"],
      ["Shillong", "2025-02-11"],
      ["Gurugram", "2025-02-14"],
    ]);
    expect(found[0]).toMatchObject({
      title: "Ed Sheeran – +−=÷× Tour",
      venueName: "Yash Lawns",
      artists: [
        { name: "Ed Sheeran", parts: [] },
        { name: "DOT", parts: [], role: "support" },
      ],
    });
    // The Mumbai 2024 show (Prateek Kuhad opening) is past either way.
    expect(found.some((c) => c.artists.some((a) => a.name === "Prateek Kuhad" && !a.role))).toBe(
      false,
    );
  });

  it("the Sunburn Festival article (history only) yields no 2026 or 2027 edition", () => {
    expect(
      extractWikipediaEditions(
        fixture("Sunburn_Festival.json"),
        { eventName: "Sunburn Festival" },
        now,
      ),
    ).toEqual([]);
  });
});

describe("artistsFromImageName", () => {
  it.each([
    [
      "Sunburn-2026-Lineup-Martin-Garrix--Alan-Walker-1080x1080.webp",
      ["Martin Garrix", "Alan Walker"],
    ],
    ["SB26-Lineup_KSHMR_Boris-Brejcha.jpg", ["KSHMR", "Boris Brejcha"]],
    ["Credits-to-Thepixen_3.webp", []],
    ["SB26_G-Sale_11920x1080-1.webp", []],
  ])("%s", (file, expected) => {
    expect(artistsFromImageName(file).map((m) => m.name)).toEqual(expected);
  });
});

describe("html", () => {
  it("decodes entities and keeps superscripts glued", () => {
    expect(decodeEntities("Johnnie &amp; Co. &#8211; &#x2019;&nbsp;")).toBe("Johnnie & Co. – ’ ");
    expect(htmlToText("<p>13<sup>th</sup> February</p><p>Mumbai &middot; 1 Day</p>")).toBe(
      "13th February\nMumbai · 1 Day",
    );
    // A newline in the HTML source is just a space (the sentence continues).
    expect(htmlToText("<p>pop star Ellie Goulding,\n   alongside GINI.</p>")).toBe(
      "pop star Ellie Goulding, alongside GINI.",
    );
  });
});

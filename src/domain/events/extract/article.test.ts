import { describe, expect, it } from "vitest";
import {
  actFromEventTitle,
  extractArticleCandidate,
  extractArtistMentions,
  findEventName,
  isLineupArticle,
  sentences,
  type Article,
} from "./article";
import type { ArtistMention } from "./candidate";
import { htmlToText } from "./html";
import { findCity, findVenue } from "./places";

const now = new Date("2026-11-21T10:00:00Z");
/** "Whole(Part, Part(Sub))": the fallback tree as one readable string. */
const show = (m: ArtistMention): string =>
  m.parts.length === 0 ? m.name : `${m.name}(${m.parts.map(show).join(", ")})`;
const names = (text: string) => extractArtistMentions(text, now).map(show);

describe("isLineupArticle", () => {
  it.each([
    ["Lollapalooza India 2027 Announces Lineup", "", true],
    ["Diljit Dosanjh to perform in Mumbai", "", true],
    ["Sunburn Festival moves to Mumbai", "The festival returns.", true],
    ["Prateek Kuhad headlines Bengaluru show", "", true],
    ["Taylor Swift announces new album", "Out on Friday in the US.", false],
    ["Charlie Puth live in London", "", false],
    ["Meet the GTA fans", "Mumbai gamers spend thousands.", false],
  ])("%s → %s", (title, text, expected) => {
    expect(isLineupArticle(title, text)).toBe(expected);
  });
});

describe("sentences", () => {
  it("does not split after month abbreviations, 'Co.' or initials", () => {
    expect(
      sentences("On Feb. 13, 2027 at Johnnie & Co. Festival. A.R. Rahman will play. Done!"),
    ).toEqual(["On Feb. 13, 2027 at Johnnie & Co. Festival.", "A.R. Rahman will play.", "Done!"]);
  });
});

describe("extractArtistMentions", () => {
  it.each<[string, string, string[]]>([
    [
      "comma list with 'and'",
      "The lineup includes Prateek Kuhad, When Chai Met Toast, Taba Chake and Nucleya.",
      [
        "Prateek Kuhad",
        "When Chai Met Toast(Chai Met Toast)",
        "Taba Chake and Nucleya(Taba Chake, Nucleya)",
      ],
    ],
    [
      "'&' band names inside an 'and' list keep their whole names first",
      "Headliners include Above & Beyond and Simon & Garfunkel.",
      [
        "Above & Beyond and Simon & Garfunkel(Above & Beyond(Above, Beyond), Simon & Garfunkel(Simon, Garfunkel))",
      ],
    ],
    [
      "b2b always splits",
      "Nucleya b2b Ritviz will close the festival lineup.",
      ["Nucleya", "Ritviz"],
    ],
    [
      "Indian names and leading describers",
      "Grammy-winning Arijit Singh will perform alongside Diljit Dosanjh with AP Dhillon.",
      ["Grammy-winning Arijit Singh(Arijit Singh)", "Diljit Dosanjh", "AP Dhillon"],
    ],
    [
      "describer joined by 'and' falls back to the parts",
      "American pop hitmaker Charlie Puth and British singer Ellie Goulding will make their India debut.",
      ["Charlie Puth and British(Charlie Puth)", "Ellie Goulding"],
    ],
    [
      "festival, venue and city phrases are not artists",
      "Kayan will perform at Johnnie & Co. Festival at Mahalaxmi Racecourse in Mumbai.",
      ["Kayan"],
    ],
    [
      "quoted songs and album titles are skipped",
      "Puth, who released his latest album Whatever's Clever, will perform “See You Again” live.",
      ["Puth"],
    ],
    [
      "past shows are not the lineup",
      "Known for hosting Avicii's performance in 2011, the venue will feature Keinemusik.",
      [],
    ],
    ["sentences without a lineup cue are ignored", "Taylor Swift released a video.", []],
  ])("%s", (_, text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it("drops a bare surname when the full name was mentioned", () => {
    const text = "Charlie Puth will perform in Mumbai. The show marks a debut for Puth.";
    expect(names(text)).toEqual(["Charlie Puth"]);
  });
});

describe("findEventName", () => {
  it.each([
    ["Sunburn Festival returns. Sunburn Festival 2026 will be in Mumbai.", "Sunburn Festival 2026"],
    ["at the inaugural edition of Johnnie & Co. Festival, performing", "Johnnie & Co. Festival"],
    ["The Lollapalooza India lineup is out", "Lollapalooza India"],
    ["Diljit Dosanjh plays Mumbai", null],
  ])("%s", (text, expected) => {
    expect(findEventName(text)).toBe(expected);
  });
});

describe("findCity / findVenue", () => {
  it.each([
    ["at Huda Grounds, Gurgaon", "Gurugram"],
    ["in Bangalore next month", "Bengaluru"],
    ["Vagator, Goa", "Goa"],
    ["across India", null],
  ])("city in %s", (text, city) => {
    expect(findCity(text)).toBe(city);
  });

  it.each([
    ["at Mahalakshmi Race Course in Mumbai", { name: "Mahalaxmi Racecourse", city: "Mumbai" }],
    ["at Jio World Garden, BKC", { name: "Jio World Garden", city: "Mumbai" }],
    ["at Phoenix Marketcity Arena in Pune", { name: "Phoenix Marketcity Arena", city: "Pune" }],
    ["Vagator Hills, Vagator, Goa", { name: "Vagator Hills", city: "Goa" }],
    ["somewhere in Pune", null],
  ])("venue in %s", (text, venue) => {
    expect(findVenue(text)).toEqual(venue);
  });
});

describe("extractArticleCandidate", () => {
  const article = (title: string, html: string): Article => ({
    source: "rollingstone",
    trust: "trusted",
    externalId: "p-1",
    url: "https://rollingstoneindia.com/a/",
    title,
    text: htmlToText(html),
  });

  it("reads the event, date, venue, city and lineup from an announcement", () => {
    const c = extractArticleCandidate(
      article(
        "Charlie Puth Will Make His India Debut",
        "<p>Charlie Puth will make his India debut at Johnnie &amp; Co. Festival, performing on Feb. 13, 2027 at Mahalaxmi Racecourse in Mumbai.</p>" +
          "<p>The lineup also includes <strong>Kayan</strong>, <strong>Gini</strong>.</p>" +
          "<p>Tickets go on sale on Nov. 25, 2026.</p>",
      ),
      now,
    );
    expect(c).toMatchObject({
      title: "Johnnie & Co. Festival",
      type: "festival",
      startsAt: new Date("2027-02-13T00:00:00+05:30"),
      endsAt: null,
      city: "Mumbai",
      country: "IN",
      venueName: "Mahalaxmi Racecourse",
    });
    expect(c?.artists.map((a) => a.name)).toEqual(["Charlie Puth", "Kayan", "Gini"]);
    expect(c?.confidence).toBeGreaterThan(0.8);
  });

  it("ignores ticket-sale dates and needs an upcoming event date", () => {
    expect(
      extractArticleCandidate(
        article("Prateek Kuhad to perform in Pune", "<p>Tickets go on sale on Dec 1, 2026.</p>"),
        now,
      ),
    ).toBeNull();
    expect(
      extractArticleCandidate(
        article("Prateek Kuhad to perform in Pune", "<p>He will perform on 2 March 2025.</p>"),
        now,
      ),
    ).toBeNull();
  });

  it("titles nothing when no event is named (the collector titles it after the headliner)", () => {
    const c = extractArticleCandidate(
      {
        ...article(
          "Prateek Kuhad to perform in Pune",
          "<p>Prateek Kuhad will perform in Pune on Dec 12.</p>",
        ),
        publishedAt: new Date("2026-11-20T00:00:00Z"),
      },
      now,
    );
    expect(c).toMatchObject({ title: null, type: "concert", city: "Pune", dateExplicit: false });
  });

  it("drops a year-less date when the publish date is unknown", () => {
    expect(
      extractArticleCandidate(
        article(
          "Prateek Kuhad to perform in Pune",
          "<p>Prateek Kuhad will perform in Pune on Dec 12.</p>",
        ),
        now,
      ),
    ).toBeNull();
  });

  it("reads year-less dates relative to the publish date, so old posts aren't upcoming", () => {
    const old = {
      ...article(
        "Sunburn Goa 2023 lineup",
        "<p>Sunburn Festival returns to Vagator, Goa on December 28th and 29th with Hardwell.</p>",
      ),
      publishedAt: new Date("2023-12-08T17:29:12+05:30"),
    };
    expect(extractArticleCandidate(old, now)).toBeNull();
    expect(
      extractArticleCandidate({ ...old, publishedAt: new Date("2026-11-01T00:00:00Z") }, now)
        ?.startsAt,
    ).toEqual(new Date("2026-12-28T00:00:00+05:30"));
  });

  it("returns null for articles that are not about an Indian event", () => {
    expect(
      extractArticleCandidate(
        article("Bruce Dickinson announces tour", "<p>He will perform in London on Dec 12.</p>"),
        now,
      ),
    ).toBeNull();
  });
});

describe("actFromEventTitle", () => {
  const show = (m: ArtistMention | null): string =>
    m === null
      ? "null"
      : m.parts.length === 0
        ? m.name
        : `${m.name}(${m.parts.map(show).join(", ")})`;
  it.each([
    ["Prateek Kuhad Live in Mumbai", "Prateek Kuhad(Prateek)"],
    ["Arijit Singh India Tour 2027", "Arijit Singh(Arijit)"],
    ["Darshan Raval's Love Letters India Tour 2026", "Darshan Raval(Darshan)"],
    ["HOME Festival 2026", "null"],
  ])("%s → %s", (title, expected) => {
    expect(show(actFromEventTitle(title))).toBe(expected);
  });
});

describe("lineup phrases and describers (official pages, outlets)", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  const show = (m: ArtistMention): string =>
    m.parts.length === 0 ? m.name : `${m.name}(${m.parts.map(show).join(", ")})`;
  const names = (text: string) => extractArtistMentions(text, now).map(show);

  it.each<[string, string, string[]]>([
    [
      "alongside an exciting lineup featuring (Team Innovation)",
      "Joining him on this spectacular musical experience is global pop star Ellie Goulding, alongside an exciting lineup featuring GINI, KAYAN, MALI and Taba Chake.",
      ["Ellie Goulding", "GINI", "KAYAN", "MALI and Taba Chake(MALI, Taba Chake)"],
    ],
    [
      "Featuring A & B, alongside 30+ artists (Team Innovation, HOME Festival)",
      "Featuring Arijit Singh & Karan Aujla, alongside 30+ incredible artists, get ready for two days of music.",
      // The validator keeps the first form Spotify confirms in each branch: Arijit Singh, Karan Aujla.
      [
        "Featuring Arijit Singh & Karan Aujla(Arijit Singh & Karan Aujla, Featuring Arijit Singh(Arijit Singh), Karan Aujla)",
      ],
    ],
    [
      "joined by",
      "Prateek Kuhad will perform in Pune, joined by Ritviz and When Chai Met Toast.",
      [
        "Prateek Kuhad",
        "Ritviz and When Chai Met Toast(Ritviz, When Chai Met Toast(Chai Met Toast))",
      ],
    ],
    [
      "a hyphenated describer falls back to the name, keeping 'DJ' in 'DJ Snake'",
      "French DJ-producer DJ Snake will headline the festival.",
      ["French DJ-producer DJ Snake(DJ-producer DJ Snake(DJ Snake(Snake)))"],
    ],
    [
      "describer-only phrases are dropped",
      "The lineup includes American EDM duo The Chainsmokers.",
      ["The Chainsmokers(Chainsmokers)"],
    ],
    [
      "sentence-initial verbs are not artists",
      "Get ready to witness Charlie Puth perform. Experience the lineup live.",
      ["Charlie Puth"],
    ],
  ])("%s", (_, text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it("names the event in the headline over festivals mentioned in passing", () => {
    expect(
      findEventName(
        "DJ Snake headlines Sunburn Festival 2026 at the racecourse, which also hosts Lollapalooza India.",
      ),
    ).toBe("Sunburn Festival 2026");
  });

  it("flags a cancelled show only from the headline", () => {
    const base = {
      source: "rollingstone" as const,
      trust: "trusted" as const,
      externalId: "x",
      url: "https://rollingstoneindia.com/x/",
      text: "Prateek Kuhad will perform at NSCI Dome in Mumbai on Dec. 12, 2026. An earlier date was postponed.",
      publishedAt: new Date("2026-11-20T00:00:00Z"),
    };
    expect(
      extractArticleCandidate({ ...base, title: "Prateek Kuhad Mumbai show cancelled" }, now)
        ?.cancelled,
    ).toBe(true);
    expect(
      extractArticleCandidate({ ...base, title: "Prateek Kuhad to perform in Mumbai" }, now)
        ?.cancelled,
    ).toBeUndefined();
  });
});

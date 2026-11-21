import { describe, expect, it } from "vitest";
import {
  asListing,
  buildSearchQuery,
  classifyMatch,
  didYouMean,
  EVENT_NICKNAMES,
  planSearch,
  rankArtists,
  rankCities,
  rankSuggestions,
  tidyQuery,
  titleSpan,
  TIER,
  type ArtistCandidate,
  type SuggestionCandidate,
} from "./search";
import { compactAlnum } from "./query-parse";
import { foldText } from "./text";
import { TREND_HALF_LIFE_MS } from "./trend";

const now = new Date("2026-11-25T06:00:00Z");
const q = (raw: string, explicit = {}) => buildSearchQuery(raw, now, explicit);

let seq = 0;
const cand = (over: Partial<SuggestionCandidate> = {}): SuggestionCandidate => ({
  id: `e${++seq}`,
  title: "Some Event",
  type: "concert",
  startsAt: new Date("2026-12-01T14:00:00Z"),
  startsAtDateOnly: false,
  city: "Pune",
  venueName: "Hard Rock Cafe",
  venueNormalizedName: "hard rock cafe",
  titleSimilarity: 0,
  venueSimilarity: 0,
  trendScore: 0,
  trendUpdatedAt: now,
  artist: null,
  ...over,
});
const artist = (name: string, normalizedName: string, similarity = 0, isFilter = false) => ({
  name,
  normalizedName,
  similarity,
  isFilter,
});
const artistCand = (over: Partial<ArtistCandidate> = {}): ArtistCandidate => ({
  id: "a1",
  name: "Prateek Kuhad",
  normalizedName: "prateek kuhad",
  spotifyId: "sp1",
  imageUrl: "https://i.scdn.co/p.jpg",
  similarity: 0,
  isFilter: false,
  upcomingCount: 1,
  ...over,
});

describe("buildSearchQuery", () => {
  it.each([
    ["  Lolla   Mumbai ", "lolla", ["lollapalooza"], { city: "Mumbai" }],
    ["NH 7", "nh7", ["nh7 weekender"], {}],
    ["VH1 Supersonic", "vh1 supersonic", ["supersonic"], {}],
    ["Beyoncé", "beyonce", [], {}],
    // "events" is a filler word.
    ["'; drop table events --", "drop table", [], {}],
    ["%%", "", [], {}],
    ["दिलजीत", "दिलजीत", [], {}],
  ])("%j → text %j, aliases %j, filters %j", (raw, text, aliases, filters) => {
    const query = q(raw);
    expect(query.text).toBe(text);
    expect(query.aliasTargets).toEqual(aliases);
    expect(query.filters).toEqual(filters);
  });

  it("explicit filters override parsed ones", () => {
    expect(q("lolla mumbai", { city: "Pune" }).filters.city).toBe("Pune");
    expect(q("", { artist: "Prateek Kuhad" }).filters).toEqual({ artist: "Prateek Kuhad" });
  });

  it.each([
    ["lo", true],
    ["nh7", true],
    ["lolla", false],
    ["दिलजी", false],
  ])("%j short: %s", (raw, short) => {
    expect(q(raw).short).toBe(short);
  });

  it("reuses the artist, venue and phonetic normalizers", () => {
    expect(q("The Local Train").artistKey).toBe("local train");
    expect(q("Palace Grounds").venueKey).toBe("palace ground");
    expect(q("diljeet").artistPhonetic).toBe("diljit");
  });

  it("every nickname key and target is already folded and compacted", () => {
    const normal = (s: string) => compactAlnum(foldText(s).split(" ")).join(" ");
    for (const [k, v] of Object.entries(EVENT_NICKNAMES)) {
      expect(normal(k)).toBe(k);
      expect(normal(v)).toBe(v);
    }
  });

  it("tidyQuery collapses whitespace", () => {
    expect(tidyQuery("  a \t\n b ")).toBe("a b");
  });
});

describe("planSearch", () => {
  it("short queries use start-of-word patterns only and no fuzzy matching (issue 1)", () => {
    const plan = planSearch(q("lo"));
    expect(plan).toMatchObject({
      fuzzy: false,
      titleAny: ["lo%", "% lo%"],
      titleAll: [],
      artistAny: ["lo%"],
      artistPhoneticAny: [],
      venueAny: ["lo%"],
    });
  });

  it("long queries add substring, both alphanumeric spellings and alias patterns", () => {
    const plan = planSearch(q("nh7 weekender"));
    expect(plan.fuzzy).toBe(true);
    expect(plan.titleAny).toEqual(["%nh7 weekender%", "%nh 7 weekender%", "%nh7 weekender%"]);
    expect(plan.titleAll).toEqual(["%nh7%", "%weekender%"]);
    expect(plan.artistPhoneticAny).toEqual(["nh7 vikender%", "% nh7 vikender%"]);
  });

  it("turns filters into SQL inputs", () => {
    const plan = planSearch(q("edm festival", { artist: "The Local Train" }));
    expect(plan.hasText).toBe(false);
    expect(plan.filters).toMatchObject({
      type: "festival",
      typeTitlePattern: "%fest%",
      genreAny: ["%edm%", "%electronic%", "%dance%"],
      artistKey: "local train",
    });
  });
});

describe("classifyMatch", () => {
  it.each<[string, string, Partial<SuggestionCandidate>, number, string, string]>([
    [
      "exact title",
      "sunburn arena",
      { title: "Sunburn Arena" },
      TIER.titlePrefix,
      "title",
      "Sunburn Arena",
    ],
    ["title prefix", "sunb", { title: "Sunburn Arena" }, TIER.titlePrefix, "title", "Sunb"],
    ["word start", "arena", { title: "Sunburn Arena" }, TIER.titleWordStart, "title", "Arena"],
    [
      "all words at word starts",
      "sunburn walker",
      { title: "Sunburn Arena ft. Alan Walker" },
      TIER.titleWordStart,
      "title",
      "Sunburn",
    ],
    [
      "substring",
      "palooza",
      { title: "Lollapalooza India" },
      TIER.titleSubstring,
      "title",
      "palooza",
    ],
    [
      "diacritics",
      "beyonce",
      { title: "Beyoncé Renaissance" },
      TIER.titlePrefix,
      "title",
      "Beyoncé",
    ],
    [
      "NH 7 typed spaced (issue 6)",
      "NH 7",
      { title: "Bacardi NH7 Weekender" },
      TIER.titleWordStart,
      "title",
      "NH7",
    ],
    ["nh7 vs a spaced title", "nh7", { title: "NH 7 Weekender" }, TIER.titlePrefix, "title", "nh7"],
    ["devanagari", "दिलजीत", { title: "दिलजीत दोसांझ लाइव" }, TIER.titlePrefix, "title", "दिलजीत"],
    [
      "nickname not in title",
      "vh1",
      { title: "Supersonic 2026" },
      TIER.alias,
      "alias",
      "Supersonic",
    ],
    [
      "artist prefix",
      "prateek",
      { title: "Silhouettes Tour", artist: artist("Prateek Kuhad", "prateek kuhad", 0.9) },
      TIER.artist,
      "artist",
      "Prateek Kuhad",
    ],
    [
      "artist surname",
      "kuhad",
      { title: "Silhouettes Tour", artist: artist("Prateek Kuhad", "prateek kuhad", 1) },
      TIER.artist,
      "artist",
      "Prateek Kuhad",
    ],
    [
      "phonetic artist (issue 11)",
      "diljeet",
      { title: "Dil-Luminati", artist: artist("Diljit Dosanjh", "diljit dosanjh", 0.5) },
      TIER.artist,
      "artist",
      "Diljit Dosanjh",
    ],
    [
      "phonetic artist badshaah",
      "badshaah",
      { title: "Paagal Tour", artist: artist("Badshah", "badshah", 0.5) },
      TIER.artist,
      "artist",
      "Badshah",
    ],
    [
      "arjit → Arijit despite a low trigram score (issue 11)",
      "arjit",
      { title: "Arijit Live", artist: artist("Arijit Singh", "arijit singh", 0.44) },
      TIER.fuzzy,
      "artist",
      "Arijit Singh",
    ],
    [
      "venue",
      "palace grounds",
      { venueName: "Palace Grounds", venueNormalizedName: "palace ground" },
      TIER.place,
      "venue",
      "Palace Grounds",
    ],
    ["city prefix", "beng", { city: "Bengaluru" }, TIER.place, "city", "Bengaluru"],
    [
      "phonetic title",
      "lolapaluza",
      { title: "Lollapalooza India" },
      TIER.phonetic,
      "fuzzy",
      "Lollapalooza",
    ],
    [
      "fuzzy title",
      "sunbrn",
      { title: "Sunburn Arena", titleSimilarity: 0.57 },
      TIER.fuzzy,
      "fuzzy",
      "Sunburn",
    ],
  ])("%s: %j", (_label, raw, over, tier, reason, matchedText) => {
    expect(classifyMatch(q(raw), cand(over))).toMatchObject({ tier, reason, matchedText });
  });

  it.each<[string, string, Partial<SuggestionCandidate>]>([
    [
      "'lo' is not The Local Train (issue 1)",
      "lo",
      {
        title: "Bacardi NH7 Weekender",
        venueName: "Lawns",
        venueNormalizedName: "lawns",
        artist: artist("The Local Train", "local train", 0.67),
      },
    ],
    ["short: no substring", "oll", { title: "Lollapalooza" }],
    ["short: no fuzzy", "sun", { title: "Moonburn", titleSimilarity: 0.9 }],
    ["fuzzy below threshold", "sunbrn", { title: "Sunburn Arena", titleSimilarity: 0.49 }],
    ["weak artist similarity", "zzzz", { artist: artist("Ritviz", "ritviz", 0.2) }],
  ])("no match: %s", (_label, raw, over) => {
    expect(classifyMatch(q(raw), cand(over))).toBeNull();
  });

  it("short queries do match the start of an artist's full name", () => {
    const m = classifyMatch(q("pra"), cand({ artist: artist("Prateek Kuhad", "prateek kuhad") }));
    expect(m).toMatchObject({ reason: "artist", matchedArtist: "Prateek Kuhad" });
  });

  it.each<[string, string, Record<string, string>, Partial<SuggestionCandidate>, string, string]>([
    ["city filter only", "gigs in pune", {}, { city: "Pune" }, "city", "Pune"],
    [
      "artist filter only",
      "",
      { artist: "Prateek Kuhad" },
      { artist: artist("Prateek Kuhad", "prateek kuhad", 0, true) },
      "artist",
      "Prateek Kuhad",
    ],
    ["date filter only", "this weekend", {}, {}, "title", ""],
  ])("filter-only: %s", (_label, raw, explicit, over, reason, matchedText) => {
    expect(classifyMatch(q(raw, explicit), cand(over))).toMatchObject({ reason, matchedText });
  });
});

describe("rankSuggestions", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 11, d, 14));

  it("orders by tier, then trend, then the soonest event (issue 10)", () => {
    const ranked = rankSuggestions(
      q("sunburn"),
      [
        cand({ id: "fuzzy", title: "Sunbrun Night", titleSimilarity: 0.6, startsAt: day(1) }),
        cand({ id: "word-soon", title: "Club Sunburn", startsAt: day(5) }),
        cand({ id: "prefix-late", title: "Sunburn Arena", startsAt: day(30) }),
        cand({ id: "prefix-soon", title: "Sunburn Festival", startsAt: day(10) }),
        cand({ id: "prefix-trending", title: "Sunburn Goa", startsAt: day(28), trendScore: 6 }),
      ],
      now,
    );
    expect(ranked.map((r) => r.id)).toEqual([
      "prefix-trending",
      "prefix-soon",
      "prefix-late",
      "word-soon",
      "fuzzy",
    ]);
  });

  it("decays trend before comparing: an old spike loses to a fresh one", () => {
    const old = new Date(now.getTime() - 3 * TREND_HALF_LIFE_MS);
    const ranked = rankSuggestions(
      q("sunburn"),
      [
        cand({ id: "old-spike", title: "Sunburn A", trendScore: 20, trendUpdatedAt: old }),
        cand({ id: "fresh", title: "Sunburn B", trendScore: 3 }),
      ],
      now,
    );
    expect(ranked.map((r) => r.id)).toEqual(["fresh", "old-spike"]);
  });

  it("keeps each event once with its best reason", () => {
    const ritviz = artist("Ritviz", "ritviz", 1);
    const ranked = rankSuggestions(
      q("ritviz"),
      [
        cand({ id: "a", title: "NH7", artist: ritviz }),
        cand({ id: "a", title: "Ritviz Live", artist: ritviz }),
      ],
      now,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ id: "a", matchReason: "title" });
    expect(ranked[0]!.matchedArtist).toBeUndefined();
  });

  it("drops non-matches", () => {
    expect(rankSuggestions(q("arena"), [cand({ title: "Nope" })], now)).toEqual([]);
  });
});

describe("entities (issue 7)", () => {
  it("lists a matching artist with upcoming shows first, with highlight text", () => {
    const entities = rankArtists(q("prateek"), [
      artistCand(),
      artistCand({
        id: "a2",
        name: "Prateek Smith",
        normalizedName: "prateek smith",
        upcomingCount: 0,
      }),
    ]);
    expect(entities).toEqual([
      {
        id: "a1",
        name: "Prateek Kuhad",
        spotifyId: "sp1",
        imageUrl: "https://i.scdn.co/p.jpg",
        upcomingCount: 1,
        matchedText: "Prateek",
      },
    ]);
  });

  it("omits unknown Spotify id and image instead of sending null", () => {
    const [entity] = rankArtists(q("prateek"), [artistCand({ spotifyId: null, imageUrl: null })]);
    expect(entity).not.toHaveProperty("spotifyId");
    expect(entity).not.toHaveProperty("imageUrl");
  });

  it.each([
    [
      "phonetic",
      "diljeet",
      artistCand({ name: "Diljit Dosanjh", normalizedName: "diljit dosanjh" }),
      1,
    ],
    [
      "typo above threshold",
      "arjit",
      artistCand({ name: "Arijit Singh", normalizedName: "arijit singh", similarity: 0.67 }),
      1,
    ],
    [
      "short, not the first word",
      "lo",
      artistCand({ name: "The Local Train", normalizedName: "local train" }),
      0,
    ],
    ["the filter artist", "", artistCand({ isFilter: true }), 1],
  ])("%s → %i entity", (_label, raw, a, count) => {
    expect(rankArtists(q(raw), [a])).toHaveLength(count);
  });

  it("orders artists by filter, direct match, then upcoming shows", () => {
    const names = rankArtists(q("ar"), [
      artistCand({
        id: "1",
        name: "Armaan Malik",
        normalizedName: "armaan malik",
        upcomingCount: 1,
      }),
      artistCand({
        id: "2",
        name: "Arijit Singh",
        normalizedName: "arijit singh",
        upcomingCount: 4,
      }),
    ]).map((a) => a.name);
    expect(names).toEqual(["Arijit Singh", "Armaan Malik"]);
  });

  it("lists the filter city and cities starting with the text", () => {
    expect(rankCities(q("gigs in pune"), [{ city: "Pune", upcomingCount: 5 }])).toEqual([
      { city: "Pune", upcomingCount: 5 },
    ]);
    expect(
      rankCities(q("beng"), [
        { city: "Bengaluru", upcomingCount: 3 },
        { city: "Pune", upcomingCount: 9 },
        { city: "Belgaum", upcomingCount: 0 },
      ]),
    ).toEqual([{ city: "Bengaluru", upcomingCount: 3 }]);
  });
});

describe("didYouMean and listings (issue 8)", () => {
  it.each([
    [
      "near-miss artist wins over a weaker title",
      "diljt dosnj",
      [cand({ title: "Dil Tour", titleSimilarity: 0.31 })],
      [artistCand({ name: "Diljit Dosanjh", similarity: 0.42 })],
      "Diljit Dosanjh",
    ],
    [
      "near-miss title",
      "lolapaloza indya",
      [cand({ title: "Lollapalooza India", titleSimilarity: 0.45 })],
      [],
      "Lollapalooza India",
    ],
    ["nothing close", "coldplay", [cand({ titleSimilarity: 0.1 })], [], undefined],
    [
      "never an artist with no published upcoming show (QA-E-4)",
      "quixotrel",
      [],
      [artistCand({ name: "Quixotrel Heldonly", similarity: 0.6, upcomingCount: 0 })],
      undefined,
    ],
    ["short queries never guess", "cp", [cand({ titleSimilarity: 0.4 })], [], undefined],
  ])("%s", (_label, raw, events, artists, expected) => {
    expect(didYouMean(q(raw), events, artists)).toBe(expected);
  });

  it("listings carry a neutral reason so clients can parse every row the same way", () => {
    const {
      venueNormalizedName: _v,
      titleSimilarity: _t,
      venueSimilarity: _s,
      trendScore: _r,
      trendUpdatedAt: _u,
      artist: _a,
      ...e
    } = cand({ id: "x" });
    expect(asListing(e)).toEqual({ ...e, matchReason: "title", matchedText: "" });
  });
});

describe("titleSpan", () => {
  it.each([
    ["Beyoncé Renaissance", "beyonce", "Beyoncé"],
    ["Guns N' Roses", "guns n roses", "Guns N' Roses"],
    ["Rock & Roll Night", "rock", "Rock"],
    ["Sunburn", "zzz", null],
  ])("%j / %j → %j", (title, needle, span) => {
    expect(titleSpan(title, needle)).toBe(span);
  });
});

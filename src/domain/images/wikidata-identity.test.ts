import { describe, expect, it } from "vitest";
import { identifyArtist, type WikidataArtist } from "./wikidata-identity";

const entity = (over: Partial<WikidataArtist> & { id: string }): WikidataArtist => ({
  names: [],
  instanceOf: ["Q5"],
  occupations: ["Q639669"],
  genres: [],
  image: "Photo.jpg",
  spotifyIds: [],
  mbids: [],
  enwikiTitle: null,
  ...over,
});

// Shapes taken from live Wikidata (2026-11-22).
const shreya = entity({
  id: "Q2050788",
  names: ["Shreya Ghoshal", "Indian singer"],
  occupations: ["Q177220", "Q33999", "Q36834", "Q639669"],
  spotifyIds: ["0oOet2f43PA68X5RxKobEy"],
});
const shreyaDiscography = entity({
  id: "Q7503728",
  names: ["Shreya Ghoshal discography"],
  instanceOf: ["Q273057"],
  occupations: [],
});
const thievery = entity({
  id: "Q546930",
  names: ["Thievery Corporation"],
  instanceOf: ["Q9212979"],
  occupations: [],
  genres: ["Q251192"],
  spotifyIds: ["25KNo5GDS6ZpLkjasaecA3"],
});
const yussef = entity({
  id: "Q96362639",
  names: ["Yussef Dayes"],
  occupations: ["Q639669", "Q386854"],
  image: null,
});
const politicianNamesake = entity({
  id: "Q1",
  names: ["Alex Turner"],
  occupations: ["Q82955"], // politician
});
const musicianNamesake = entity({ id: "Q2", names: ["Alex Turner"], occupations: ["Q177220"] });
const anotherMusicianNamesake = entity({
  id: "Q3",
  names: ["Alex Turner"],
  occupations: ["Q130857"],
});

const subject = (name: string, spotifyId: string | null = null, mbid: string | null = null) => ({
  name,
  spotifyId,
  mbid,
});

describe("identifyArtist", () => {
  it.each([
    [
      "the right person, by Spotify ID",
      subject("Shreya Ghoshal", "0oOet2f43PA68X5RxKobEy"),
      [shreyaDiscography, shreya],
      "Q2050788",
      1,
    ],
    [
      "the right person, by name (one music act)",
      subject("Shreya Ghoshal"),
      [shreyaDiscography, shreya],
      "Q2050788",
      0.8,
    ],
    [
      "a duo, by Spotify ID",
      subject("Thievery Corporation", "25KNo5GDS6ZpLkjasaecA3"),
      [thievery],
      "Q546930",
      1,
    ],
    ["a duo, by name", subject("Thievery Corporation"), [thievery], "Q546930", 0.8],
    [
      "a lineup name with a suffix",
      subject("Thievery Corporation (Live)"),
      [thievery],
      "Q546930",
      0.8,
    ],
    [
      "a person with no P18 is still identified",
      subject("Yussef Dayes"),
      [yussef],
      "Q96362639",
      0.8,
    ],
    [
      "a musician beside a non-music namesake",
      subject("Alex Turner"),
      [politicianNamesake, musicianNamesake],
      "Q2",
      0.8,
    ],
    [
      "a duo whose label uses a different joiner",
      subject("Salim & Sulaiman"),
      [
        entity({
          id: "Q3124942",
          names: ["Salim-Sulaiman"],
          instanceOf: ["Q215380"],
          occupations: ["Q1415090"],
        }),
      ],
      "Q3124942",
      0.8,
    ],
    [
      "by MusicBrainz ID",
      subject("X", null, "mb-1"),
      [entity({ id: "Q9", names: ["Y"], mbids: ["mb-1"] })],
      "Q9",
      1,
    ],
  ] as const)("%s", (_label, s, entities, id, confidence) => {
    const found = identifyArtist(s, entities);
    expect(found?.entity.id).toBe(id);
    expect(found?.confidence).toBe(confidence);
  });

  it.each([
    ["a non-music namesake only", subject("Alex Turner"), [politicianNamesake]],
    ["two musician namesakes", subject("Alex Turner"), [musicianNamesake, anotherMusicianNamesake]],
    [
      "an entity linked to a different Spotify artist",
      subject("Shreya Ghoshal", "someoneElse0000000000x"),
      [shreya],
    ],
    [
      "an entity linked to a different MusicBrainz artist",
      subject("Alex Turner", null, "mb-1"),
      [entity({ id: "Q4", names: ["Alex Turner"], occupations: ["Q177220"], mbids: ["mb-2"] })],
    ],
    ["a discography item", subject("Shreya Ghoshal discography"), [shreyaDiscography]],
    ["a different name", subject("Shreya"), [shreya]],
    [
      "a person whose name only matches without the joiner",
      subject("Simon & Garfunkel"),
      [entity({ id: "Q11", names: ["Simon Garfunkel"], occupations: ["Q177220"] })],
    ],
    [
      "a common name without a Spotify link",
      subject("Felix"),
      [entity({ id: "Q5", names: ["Felix"], occupations: ["Q130857"] })],
    ],
    [
      "a short name without a Spotify link",
      subject("HRX"),
      [entity({ id: "Q6", names: ["HRX"], occupations: ["Q2252262"] })],
    ],
    [
      "a collab part's name",
      subject("Khan & Noor"),
      [entity({ id: "Q7", names: ["Khan"], occupations: ["Q177220"] })],
    ],
    ["no entities", subject("Shreya Ghoshal"), []],
  ] as const)("refuses %s", (_label, s, entities) => {
    expect(identifyArtist(s, entities)).toBeNull();
  });

  it("accepts a common name when the Spotify ID matches", () => {
    const felix = entity({ id: "Q8", names: ["Felix"], spotifyIds: ["4UIOuc84ExWojcUzFGtb8W"] });
    expect(identifyArtist(subject("Felix", "4UIOuc84ExWojcUzFGtb8W"), [felix])?.entity.id).toBe(
      "Q8",
    );
  });

  it("explains its choice", () => {
    expect(
      identifyArtist(subject("Shreya Ghoshal", "0oOet2f43PA68X5RxKobEy"), [shreya])?.evidence,
    ).toEqual(["Q2050788: P1902 Spotify ID matches"]);
  });
});

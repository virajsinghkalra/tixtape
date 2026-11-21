import { describe, expect, it } from "vitest";
import { normalizeArtistName, splitArtistCredit } from "./normalize";

describe("normalizeArtistName", () => {
  it.each([
    // Indian artists
    ["Prateek Kuhad", "prateek kuhad"],
    ["Seedhe Maut", "seedhe maut"],
    ["Ritviz", "ritviz"],
    ["Anuv Jain", "anuv jain"],
    ["When Chai Met Toast", "when chai met toast"],
    ["DIVINE", "divine"],
    ["A.R. Rahman", "ar rahman"],
    ["AR Rahman", "ar rahman"],
    ["The Local Train", "local train"],
    ["Raghu Dixit Project", "raghu dixit project"],
    // Casefold, diacritics, whitespace
    ["  Prateek   Kuhad  ", "prateek kuhad"],
    ["Beyoncé", "beyonce"],
    ["Sigur Rós", "sigur ros"],
    ["MØ", "mø"],
    ["Ólafur Arnalds", "olafur arnalds"],
    ["İlhan", "ilhan"],
    ["ＤＩＶＩＮＥ", "divine"],
    // & / and / +
    ["Above & Beyond", "above and beyond"],
    ["Above and Beyond", "above and beyond"],
    ["Florence + The Machine", "florence and the machine"],
    ["Simon&Garfunkel", "simon and garfunkel"],
    // Leading "the" / "DJ"
    ["DJ Snake", "snake"],
    ["dj snake", "snake"],
    ["The Weeknd", "weeknd"],
    ["The DJ Shadow", "shadow"],
    ["The The", "the"],
    ["DJ", "dj"],
    ["Theory of a Deadman", "theory of a deadman"],
    ["DJs From Mars", "djs from mars"],
    // Performance suffixes
    ["KSHMR (Live)", "kshmr"],
    ["Nucleya (DJ Set)", "nucleya"],
    ["Bicep [Hybrid]", "bicep"],
    ["Bonobo (Live Set)", "bonobo"],
    ["Ritviz (Live) [Hybrid]", "ritviz"],
    ["Four Tet ( dj set )", "four tet"],
    ["(Live)", "live"],
    ["Live", "live"],
    ["Sunburn (Goa)", "sunburn goa"],
    // Punctuation
    ["Dr. Dre", "dr dre"],
    ["Guns N' Roses", "guns n roses"],
    ["AC/DC", "ac dc"],
    ["P!nk", "p nk"],
    ["deadmau5", "deadmau5"],
    ["Mumford & Sons!", "mumford and sons"],
    // Non-Latin scripts stay intact
    ["दिव्य", "दिव्य"],
    ["  अरिजीत   सिंह ", "अरिजीत सिंह"],
    ["क़व्वाली", "क़व्वाली"],
    ["坂本龍一", "坂本龍一"],
    // Empty-ish input
    ["", ""],
    ["   ", ""],
    ["!!!", ""],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeArtistName(raw)).toBe(expected);
  });

  it.each([
    "Prateek Kuhad",
    "The DJ Shadow (Live) [Hybrid]",
    "The The",
    "the the the",
    "Beyoncé & Jay-Z",
    "DJ DJ Snake",
    "क़व्वाली",
    "ＤＩＶＩＮＥ (live)",
    "İstanbul",
    "A.R. Rahman + friends",
    "(Live) (Live)",
  ])("is idempotent for %j", (raw) => {
    const once = normalizeArtistName(raw);
    expect(normalizeArtistName(once)).toBe(once);
  });
});

describe("splitArtistCredit", () => {
  it.each([
    ["Nucleya b2b Ritviz", ["Nucleya", "Ritviz"]],
    ["Nucleya B2B Ritviz", ["Nucleya", "Ritviz"]],
    ["Ben UFO b2b Joy Orbison b2b Four Tet", ["Ben UFO", "Joy Orbison", "Four Tet"]],
    ["Seedhe Maut vs KR$NA", ["Seedhe Maut", "KR$NA"]],
    ["Seedhe Maut vs. KR$NA", ["Seedhe Maut", "KR$NA"]],
    ["Ritviz x Nucleya", ["Ritviz", "Nucleya"]],
    ["Ritviz × Nucleya", ["Ritviz", "Nucleya"]],
    ["Ritviz X Nucleya", ["Ritviz", "Nucleya"]],
    // A name ending in "X" keeps it (QA-M-1)
    ["Lil Nas X x Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Lil Nas X X Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Lil Nas X b2b Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Lil Nas X feat. Jack Harlow", ["Lil Nas X", "Jack Harlow"]],
    ["Jack Harlow x Lil Nas X", ["Jack Harlow", "Lil Nas X"]],
    ["Malcolm X x Lil Nas X", ["Malcolm X", "Lil Nas X"]],
    ["X Ambassadors x Ritviz", ["X Ambassadors", "Ritviz"]],
    ["Anuv Jain feat. Lisa Mishra", ["Anuv Jain", "Lisa Mishra"]],
    ["Anuv Jain ft. Lisa Mishra", ["Anuv Jain", "Lisa Mishra"]],
    ["Anuv Jain featuring Lisa Mishra", ["Anuv Jain", "Lisa Mishra"]],
    ["Anuv Jain (feat. Lisa Mishra)", ["Anuv Jain", "Lisa Mishra"]],
    ["  Prateek Kuhad  ", ["Prateek Kuhad"]],
    // Not split
    ["Simon & Garfunkel", ["Simon & Garfunkel"]],
    ["Above and Beyond", ["Above and Beyond"]],
    ["When Chai Met Toast", ["When Chai Met Toast"]],
    ["Xavier Rudd", ["Xavier Rudd"]],
    ["Malcolm X", ["Malcolm X"]],
    ["Lil Nas X", ["Lil Nas X"]],
    ["X Ambassadors", ["X Ambassadors"]],
    ["The xx", ["The xx"]],
    ["Maxx", ["Maxx"]],
    ["Featurecast", ["Featurecast"]],
    ["KSHMR (Live)", ["KSHMR (Live)"]],
    // Never empty strings
    ["", []],
    ["   ", []],
    ["Nucleya b2b ", ["Nucleya"]],
    ["A  b2b  b2b  B", ["A", "B"]],
  ])("%j → %j", (raw, expected) => {
    expect(splitArtistCredit(raw)).toEqual(expected);
  });
});

import { describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { newestReleaseYear, webCitations, type CitingPage } from "./evidence";

const REAL = asSpotifyArtistId("5Us2dsq4VHlfLbKOrskg7K");
const DUPE = asSpotifyArtistId("6pRC2yQLAFRk0FMziCkbau");
const page = (url: string, title: string, content = ""): CitingPage => ({ url, title, content });

describe("webCitations", () => {
  // Shapes taken from a real Tavily search for "MXRCI open.spotify.com artist".
  const mxrciPages = [
    page(
      "https://discography.in/articles/mxrci-songs",
      "Mxrci: Songs, Karan Aujla Hits",
      `listen https://open.spotify.com/artist/${REAL}`,
    ),
    page(`https://open.spotify.com/artist/${DUPE}`, "Mxrci | Spotify"),
    page(`https://kworb.net/spotify/artist/${REAL}_songs.html`, "Mxrci - Spotify Top Songs"),
    page(`https://www.musicmetricsvault.com/artists/mxrci/${REAL}`, "Mxrci - Spotify Statistics"),
    page(`https://app.artist.tools/artist/${REAL}/tracks`, "Mxrci Most Streamed Songs"),
    page("https://genius.com/artists/Mxrci", "MXRCI Lyrics"),
  ];

  it("counts distinct hosts citing each candidate", () => {
    const hosts = webCitations(mxrciPages, ["MXRCI (Live Set)", "MXRCI"], [REAL, DUPE]);
    expect(hosts.get(REAL)).toEqual([
      "app.artist.tools",
      "discography.in",
      "kworb.net",
      "musicmetricsvault.com",
    ]);
    expect(hosts.get(DUPE)).toEqual(["open.spotify.com"]);
  });

  it.each([
    ["ignores IDs that aren't candidates", [DUPE], { [DUPE]: ["open.spotify.com"] }],
    ["returns nothing without candidates", [], {}],
  ])("%s", (_label, candidates, expected) => {
    expect(Object.fromEntries(webCitations(mxrciPages, ["MXRCI"], candidates))).toEqual(expected);
  });

  it.each([
    ["a page that doesn't name the artist", page(`https://kworb.net/x/${REAL}`, "Top songs", "")],
    ["a name only inside another word", page(`https://kworb.net/x/${REAL}`, "MXRCIZ songs")],
    ["an unparseable URL", page(`not a url ${REAL}`, "MXRCI")],
  ])("skips %s", (_label, p) => {
    expect(webCitations([p], ["MXRCI"], [REAL]).size).toBe(0);
  });

  it("counts one host once however many of its pages cite the ID", () => {
    const pages = [
      page(`https://kworb.net/a/${REAL}`, "MXRCI"),
      page(`https://www.kworb.net/b/${REAL}`, "MXRCI"),
    ];
    expect(webCitations(pages, ["MXRCI"], [REAL]).get(REAL)).toEqual(["kworb.net"]);
  });

  it("matches the artist by any variant name", () => {
    const pages = [page(`https://site.in/dhyan/${REAL}`, "Dhyan: DJ and producer")];
    expect(webCitations(pages, ["Dhyan Live", "Dhyan"], [REAL]).get(REAL)).toEqual(["site.in"]);
  });
});

describe("newestReleaseYear", () => {
  it.each([
    [[{ releaseDate: "2019-04-01" }, { releaseDate: "2025" }, { releaseDate: "2024-11" }], 2025],
    [[{ releaseDate: null }, { releaseDate: "2023-01-01" }], 2023],
    [[{ releaseDate: null }, { releaseDate: "unknown" }], null],
    [[], null],
  ])("%j → %s", (releases, expected) => {
    expect(newestReleaseYear(releases)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { asSpotifyArtistId, asSpotifyTrackId, type SpotifyArtistId } from "@/domain/shared/ids";
import type { BillingTier } from "@/domain/shared/lineup";
import {
  orderPlaylist,
  pickedTrack,
  selectArtistTracks,
  tierTotal,
  type PickedTrack,
  type SignalCandidates,
  type TrackCandidate,
} from "./selection";

const A = asSpotifyArtistId("artistA");
const B = asSpotifyArtistId("artistB");

/** `t("ml3")` is a track by A named "ml3"; options override the rest. */
function t(
  id: string,
  over: { name?: string; artists?: SpotifyArtistId[]; isrc?: string | null } = {},
): TrackCandidate {
  return {
    id: asSpotifyTrackId(id),
    name: over.name ?? id,
    artistIds: over.artists ?? [A],
    isrc: over.isrc ?? null,
  };
}

const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`${prefix}${i}`));

function signals(over: Partial<SignalCandidates> = {}): SignalCandidates {
  return { mostListened: [], trending: [], newest: [], search: [], ...over };
}

const pick = (
  tier: BillingTier,
  s: SignalCandidates,
  alreadyPicked: PickedTrack[] = [],
): string[] =>
  selectArtistTracks({ tier, artistId: A, signals: s, alreadyPicked }).map((x) => x.id);

describe("selectArtistTracks: quotas (D-038)", () => {
  const full = signals({
    mostListened: many("ml", 10),
    trending: many("tr", 10),
    newest: many("nw", 10),
    search: many("se", 10),
  });

  it.each<[BillingTier, string[]]>([
    ["headliner", ["ml0", "ml1", "ml2", "ml3", "ml4", "tr0", "tr1", "tr2", "nw0", "nw1"]],
    ["sub", ["ml0", "ml1", "ml2", "tr0", "nw0"]],
    ["mid", ["ml0", "ml1", "tr0"]],
    ["support", ["ml0", "tr0"]],
  ])("%s takes its mix", (tier, expected) => {
    expect(pick(tier, full)).toEqual(expected);
    expect(expected).toHaveLength(tierTotal(tier));
  });
});

describe("selectArtistTracks: rollover", () => {
  it.each<[string, BillingTier, SignalCandidates, string[]]>([
    [
      "missing trending rolls to newest, then search",
      "headliner",
      signals({ mostListened: many("ml", 5), newest: many("nw", 3), search: many("se", 5) }),
      ["ml0", "ml1", "ml2", "ml3", "ml4", "nw0", "nw1", "nw2", "se0", "se1"],
    ],
    [
      "short most-listened rolls to trending",
      "sub",
      signals({ mostListened: many("ml", 1), trending: many("tr", 5), newest: many("nw", 5) }),
      ["ml0", "tr0", "tr1", "tr2", "nw0"],
    ],
    [
      "mid's trending-or-newest slot uses newest when not charting",
      "mid",
      signals({ mostListened: many("ml", 5), newest: many("nw", 5) }),
      ["ml0", "ml1", "nw0"],
    ],
    ["only search results", "support", signals({ search: many("se", 5) }), ["se0", "se1"]],
    [
      "backfills from an earlier signal when later ones run dry",
      "sub",
      signals({ mostListened: many("ml", 9) }),
      ["ml0", "ml1", "ml2", "ml3", "ml4"],
    ],
    ["nothing at all", "headliner", signals(), []],
  ])("%s", (_name, tier, s, expected) => {
    expect(pick(tier, s)).toEqual(expected);
  });
});

describe("selectArtistTracks: filters", () => {
  it.each<[string, SignalCandidates, string[]]>([
    [
      "skips tracks not credited to the artist",
      signals({ mostListened: [t("x", { artists: [B] }), t("ml0")], search: many("se", 3) }),
      ["ml0", "se0"],
    ],
    [
      "accepts collaborations that include the artist",
      signals({ mostListened: [t("collab", { artists: [B, A] })], search: many("se", 3) }),
      ["collab", "se0"],
    ],
    [
      "skips a live version when the original is in the pool",
      signals({
        mostListened: [t("live", { name: "Tum Hi Ho (Live)" })],
        search: [t("orig", { name: "Tum Hi Ho" }), t("se1")],
      }),
      ["orig", "se1"],
    ],
    [
      "keeps a remix when no original exists",
      signals({ mostListened: [t("rmx", { name: "Cold Mess (Remix)" })], search: [t("se0")] }),
      ["rmx", "se0"],
    ],
    [
      "skips sped-up, slowed, karaoke, instrumental and acoustic copies of an original",
      signals({
        mostListened: [
          t("a", { name: "Song (Sped Up)" }),
          t("b", { name: "Song (Slowed + Reverb)" }),
          t("c", { name: "Song (Karaoke Version)" }),
          t("d", { name: "Song - Instrumental" }),
          t("e", { name: "Song (Acoustic)" }),
        ],
        newest: [t("orig", { name: "Song" })],
        search: [t("other")],
      }),
      ["orig", "other"],
    ],
    [
      "treats a (From …) title as the same song",
      signals({
        mostListened: [t("from", { name: 'Kesariya (From "Brahmastra")' })],
        search: [t("plain", { name: "Kesariya" }), t("se1")],
      }),
      ["from", "se1"],
    ],
  ])("%s", (_name, s, expected) => {
    expect(pick("support", s)).toEqual(expected);
  });
});

describe("selectArtistTracks: dedupe", () => {
  it.each<[string, SignalCandidates, PickedTrack[], string[]]>([
    [
      "by Spotify id across signals",
      signals({ mostListened: [t("same")], trending: [t("same")], search: [t("se0")] }),
      [],
      ["same", "se0"],
    ],
    [
      "by ISRC (case-insensitive)",
      signals({
        mostListened: [t("a", { name: "One", isrc: "INabc1" })],
        search: [t("b", { name: "Two", isrc: "INABC1" }), t("c")],
      }),
      [],
      ["a", "c"],
    ],
    [
      "by normalized title + primary artist",
      signals({
        mostListened: [t("a", { name: "Kho Gaye" })],
        search: [t("b", { name: "KHO GAYE - Remastered" }), t("c")],
      }),
      [],
      ["a", "c"],
    ],
    [
      "keeps same title by a different primary artist",
      signals({
        mostListened: [t("a", { name: "Intro" })],
        search: [t("b", { name: "Intro", artists: [B, A] })],
      }),
      [],
      ["a", "b"],
    ],
    [
      "never repeats a track an earlier artist already took",
      signals({ mostListened: [t("shared"), t("ml1")], search: [t("se0")] }),
      [pickedTrack(t("shared", { artists: [B, A] }))],
      ["ml1", "se0"],
    ],
  ])("%s", (_name, s, already, expected) => {
    expect(pick("support", s, already)).toEqual(expected);
  });
});

describe("orderPlaylist (D-040)", () => {
  const ids = (...xs: string[]) => xs.map(asSpotifyTrackId);

  it("puts tiers in order and interleaves artists within a tier by billing rank", () => {
    expect(
      orderPlaylist([
        { tier: "support", billingRank: 9, trackIds: ids("s1", "s2") },
        { tier: "headliner", billingRank: 2, trackIds: ids("h2a", "h2b") },
        { tier: "headliner", billingRank: 1, trackIds: ids("h1a", "h1b", "h1c") },
        { tier: "sub", billingRank: 3, trackIds: ids("u1") },
      ]),
    ).toEqual(["h1a", "h2a", "h1b", "h2b", "h1c", "u1", "s1", "s2"]);
  });

  it.each([
    ["empty", [], []],
    ["artist with no tracks", [{ tier: "mid" as const, billingRank: 1, trackIds: [] }], []],
  ])("%s", (_n, input, expected) => {
    expect(orderPlaylist(input)).toEqual(expected);
  });
});

/**
 * QA P2.1: per-artist song selection and playlist order (D-038, D-040, LLD §7.2).
 * Written from the spec and exported signatures only.
 */
import { describe, expect, it } from "vitest";
import {
  orderPlaylist,
  pickedTrack,
  selectArtistTracks,
  TIER_QUOTAS,
  tierTotal,
  type ArtistPicks,
  type SignalCandidates,
  type TrackCandidate,
} from "@/domain/playlists/selection";
import { normalizeTrackTitle, trackVersion } from "@/domain/playlists/track-title";
import type { BillingTier } from "@/domain/shared/lineup";
import { asSpotifyArtistId, asSpotifyTrackId, type SpotifyArtistId } from "@/domain/shared/ids";

const A = asSpotifyArtistId("AR00000000000000000000A");
const B = asSpotifyArtistId("AR00000000000000000000B");

let n = 0;
const t = (name: string, o: Partial<TrackCandidate> = {}): TrackCandidate => {
  n += 1;
  return {
    id: o.id ?? asSpotifyTrackId(`TR${String(n).padStart(20, "0")}`),
    name,
    artistIds: o.artistIds ?? [A],
    isrc: o.isrc === undefined ? null : o.isrc,
  };
};
const many = (prefix: string, k: number, artist: SpotifyArtistId = A) =>
  Array.from({ length: k }, (_, i) => t(`${prefix} ${i}`, { artistIds: [artist] }));

const sig = (s: Partial<SignalCandidates>): SignalCandidates => ({
  mostListened: [],
  trending: [],
  newest: [],
  search: [],
  ...s,
});

const select = (
  tier: BillingTier,
  signals: SignalCandidates,
  alreadyPicked = [] as ReturnType<typeof pickedTrack>[],
  artistId = A,
) => selectArtistTracks({ tier, artistId, signals, alreadyPicked });

const countFrom = (picked: TrackCandidate[], pool: readonly TrackCandidate[]) =>
  picked.filter((p) => pool.some((q) => q.id === p.id)).length;

describe("QA D-038 tier quotas", () => {
  it("declares headliner 5/3/2, sub 3/1/1 and totals 10/5/3/2", () => {
    expect(TIER_QUOTAS.headliner).toEqual({ mostListened: 5, trending: 3, newest: 2 });
    expect(TIER_QUOTAS.sub).toEqual({ mostListened: 3, trending: 1, newest: 1 });
    expect([
      tierTotal("headliner"),
      tierTotal("sub"),
      tierTotal("mid"),
      tierTotal("support"),
    ]).toEqual([10, 5, 3, 2]);
  });

  it.each([
    ["headliner", 5, 3, 2],
    ["sub", 3, 1, 1],
  ] as const)(
    "%s takes %i most-listened, %i trending, %i newest when every signal is full",
    (tier, ml, tr, nw) => {
      const s = sig({
        mostListened: many("ml", 10),
        trending: many("tr", 10),
        newest: many("nw", 10),
        search: many("se", 10),
      });
      const out = select(tier, s);
      expect(out).toHaveLength(ml + tr + nw);
      expect(countFrom(out, s.mostListened)).toBe(ml);
      expect(countFrom(out, s.trending)).toBe(tr);
      expect(countFrom(out, s.newest)).toBe(nw);
      expect(countFrom(out, s.search)).toBe(0);
    },
  );

  it("mid: 2 most-listened + 1 trending when charting; the slot goes to newest when not", () => {
    const charting = select(
      "mid",
      sig({ mostListened: many("ml", 5), trending: many("tr", 5), newest: many("nw", 5) }),
    );
    expect(charting).toHaveLength(3);
    expect(charting.filter((x) => x.name.startsWith("ml"))).toHaveLength(2);
    expect(charting.filter((x) => x.name.startsWith("tr"))).toHaveLength(1);
    const notCharting = sig({ mostListened: many("ml", 5), newest: many("nw", 5) });
    const out = select("mid", notCharting);
    expect(out).toHaveLength(3);
    expect(countFrom(out, notCharting.newest)).toBe(1);
  });

  it("support: 1 most-listened + 1 trending-or-newest", () => {
    const s = sig({ mostListened: many("ml", 5), newest: many("nw", 5) });
    const out = select("support", s);
    expect(out).toHaveLength(2);
    expect(countFrom(out, s.mostListened)).toBe(1);
    expect(countFrom(out, s.newest)).toBe(1);
  });

  it("caps at the tier total even when every signal is huge", () => {
    const s = sig({
      mostListened: many("ml", 50),
      trending: many("tr", 50),
      newest: many("nw", 50),
      search: many("se", 50),
    });
    for (const tier of ["headliner", "sub", "mid", "support"] as const)
      expect(select(tier, s)).toHaveLength(tierTotal(tier));
  });
});

describe("QA D-038 rollover", () => {
  it("headliner with no most-listened still gets 10 songs from the other signals", () => {
    const s = sig({ trending: many("tr", 4), newest: many("nw", 4), search: many("se", 10) });
    const out = select("headliner", s);
    expect(out).toHaveLength(10);
    expect(countFrom(out, s.trending)).toBe(4);
    expect(countFrom(out, s.newest)).toBe(4);
  });

  it("headliner with only the search signal gets 10", () => {
    expect(select("headliner", sig({ search: many("se", 10) }))).toHaveLength(10);
  });

  it("short most-listened rolls the gap to the next signal, not dropped", () => {
    const s = sig({
      mostListened: many("ml", 2),
      trending: many("tr", 10),
      newest: many("nw", 10),
    });
    const out = select("headliner", s);
    expect(out).toHaveLength(10);
    expect(countFrom(out, s.mostListened)).toBe(2);
  });

  it("artist with zero tracks anywhere returns [] without throwing", () => {
    expect(select("headliner", sig({}))).toEqual([]);
  });

  it("fewer songs than the quota returns what exists, no duplicates", () => {
    const one = t("only song");
    const out = select(
      "headliner",
      sig({ mostListened: [one], trending: [one], newest: [one], search: [one] }),
    );
    expect(out.map((x) => x.id)).toEqual([one.id]);
  });
});

describe("QA D-038 eligibility and dedupe", () => {
  it("drops candidates that don't credit the resolved artist id", () => {
    const foreign = t("Other Song", { artistIds: [B] });
    const out = select("support", sig({ mostListened: [foreign], search: many("se", 3) }));
    expect(out.map((x) => x.id)).not.toContain(foreign.id);
    expect(out).toHaveLength(2);
  });

  it("keeps a collaboration that credits the artist as a featured (non-primary) artist", () => {
    const collab = t("Duet", { artistIds: [B, A] });
    const out = select("support", sig({ mostListened: [collab] }));
    expect(out.map((x) => x.id)).toContain(collab.id);
  });

  it("dedupes by id across signals", () => {
    const s1 = t("Hit");
    const out = select(
      "headliner",
      sig({
        mostListened: [s1, ...many("ml", 4)],
        trending: [s1, ...many("tr", 5)],
        newest: many("nw", 5),
      }),
    );
    expect(new Set(out.map((x) => x.id)).size).toBe(out.length);
    expect(out).toHaveLength(10);
  });

  it("dedupes by ISRC case-insensitively (different ids, same recording)", () => {
    const a = t("Hit", { isrc: "INUM71900123" });
    const b = t("Hit (2019)", { isrc: "inum71900123" });
    const out = select("support", sig({ mostListened: [a], trending: [b], search: many("se", 3) }));
    expect(out.map((x) => x.id)).toContain(a.id);
    expect(out.map((x) => x.id)).not.toContain(b.id);
  });

  it("dedupes by normalised title + primary artist when ids and ISRCs differ", () => {
    const a = t("Kesariya", { isrc: null });
    const b = t("KESARIYA ", { isrc: null });
    const out = select("support", sig({ mostListened: [a], trending: [b], search: many("se", 3) }));
    expect(out.map((x) => x.id)).not.toContain(b.id);
  });

  it("same title by a different primary artist is not a duplicate", () => {
    const mine = t("Intro", { artistIds: [A] });
    const theirs = pickedTrack(t("Intro", { artistIds: [B] }));
    const out = select("support", sig({ mostListened: [mine] }), [theirs]);
    expect(out.map((x) => x.id)).toContain(mine.id);
  });

  it("a collaboration already picked for another artist is not picked again", () => {
    const collab = t("Duet", { artistIds: [B, A] });
    const out = select("support", sig({ mostListened: [collab], search: many("se", 3) }), [
      pickedTrack(collab),
    ]);
    expect(out.map((x) => x.id)).not.toContain(collab.id);
    expect(out).toHaveLength(2);
  });

  it("already-picked ISRC from another artist is respected", () => {
    const prev = pickedTrack(t("Song", { isrc: "USABC1234567", artistIds: [B, A] }));
    const dup = t("Song", { isrc: "USABC1234567", artistIds: [A, B] });
    expect(select("support", sig({ mostListened: [dup] }), [prev]).map((x) => x.id)).not.toContain(
      dup.id,
    );
  });
});

describe("QA D-038 version filters", () => {
  const versions = [
    "Tum Hi Ho (Live)",
    "Tum Hi Ho - Live at Wembley",
    "Tum Hi Ho (DJ Remix)",
    "Tum Hi Ho - Karaoke Version",
    "Tum Hi Ho (Sped Up)",
    "Tum Hi Ho (Slowed + Reverb)",
    "Tum Hi Ho (Instrumental)",
    "Tum Hi Ho (Acoustic)",
    "Tum Hi Ho - Sped Up Version",
    "Tum Hi Ho (Slowed & Reverb)",
    "Tum Hi Ho [Remix] (feat. DJ X)",
    "Tum Hi Ho - Unplugged",
    "Tum Hi Ho (Live) - Remastered 2020",
  ];

  it("skips a version even when the original only appears in a later signal", () => {
    const version = t("Tum Hi Ho (Sped Up)");
    const original = t("Tum Hi Ho");
    const out = select(
      "support",
      sig({ mostListened: [version], search: [original, ...many("se", 3)] }),
    );
    expect(out.map((x) => x.id)).not.toContain(version.id);
    expect(out.map((x) => x.id)).toContain(original.id);
  });

  it.each(versions)("trackVersion recognises %s", (title) => {
    expect(trackVersion(title)).not.toBeNull();
  });

  it.each(versions)("skips %s when the original exists", (title) => {
    const original = t("Tum Hi Ho");
    const version = t(title);
    const out = select(
      "support",
      sig({ mostListened: [version, original], search: many("se", 3) }),
    );
    expect(out.map((x) => x.id)).toContain(original.id);
    expect(out.map((x) => x.id)).not.toContain(version.id);
  });

  it("keeps a live version when no original exists", () => {
    const live = t("Unreleased Jam (Live)");
    expect(select("support", sig({ mostListened: [live] })).map((x) => x.id)).toContain(live.id);
  });

  it('"(From …)" is a soundtrack credit, not a version: kept and stripped by normalisation', () => {
    expect(trackVersion('Kesariya (From "Brahmastra")')).toBeNull();
    expect(normalizeTrackTitle('Kesariya (From "Brahmastra")')).toBe(
      normalizeTrackTitle("Kesariya"),
    );
    expect(normalizeTrackTitle('Kesariya - From "Brahmastra"')).toBe(
      normalizeTrackTitle("Kesariya"),
    );
  });

  it("normalisation strips feat. and remaster tags", () => {
    const base = normalizeTrackTitle("Brown Munde");
    expect(normalizeTrackTitle("Brown Munde (feat. Gurinder Gill)")).toBe(base);
    expect(normalizeTrackTitle("Brown Munde - Remastered 2021")).toBe(base);
    expect(normalizeTrackTitle("BROWN MUNDE")).toBe(base);
  });

  // Ambiguity: the spec names version *markers*, but real song titles contain the same words.
  const realTitles = [
    "Live Forever",
    "Live While We're Young",
    "Remixed Feelings",
    "Alive",
    "Delivery",
    "Flip Reset",
    "Reverb Dreams",
  ];
  it.each(realTitles)("real song title %s is not treated as a version", (title) => {
    // Only bracketed / dash-suffixed markers should count as versions.
    expect(trackVersion(title)).toBeNull();
  });

  it("a real title like 'Live Forever' is still selected (alongside unrelated songs)", () => {
    const lf = t("Live Forever");
    const out = select("support", sig({ mostListened: [lf, t("Wonderwall")] }));
    expect(out.map((x) => x.id)).toContain(lf.id);
  });
});

describe("QA D-040 order", () => {
  const ids = (artist: string, k: number) =>
    Array.from({ length: k }, (_, i) => asSpotifyTrackId(`${artist}${i}`));
  const tierOf = (id: string) => id.split("_")[0];
  const artistOf = (id: string) => id.replace(/\d+$/u, "");

  it("headliners first, then sub, mid, support, regardless of input order", () => {
    const input: ArtistPicks[] = [
      { tier: "support", billingRank: 9, trackIds: ids("support_s", 2) },
      { tier: "mid", billingRank: 7, trackIds: ids("mid_m", 3) },
      { tier: "headliner", billingRank: 2, trackIds: ids("headliner_h", 10) },
      { tier: "sub", billingRank: 5, trackIds: ids("sub_b", 5) },
    ];
    const out = orderPlaylist(input);
    expect(out).toHaveLength(20);
    const tiers = out.map(tierOf);
    const order = ["headliner", "sub", "mid", "support"];
    for (let i = 1; i < tiers.length; i += 1)
      expect(order.indexOf(tiers[i]!)).toBeGreaterThanOrEqual(order.indexOf(tiers[i - 1]!));
  });

  it("round-robins artists within a tier by billing rank", () => {
    const out = orderPlaylist([
      { tier: "headliner", billingRank: 3, trackIds: ids("headliner_c", 2) },
      { tier: "headliner", billingRank: 1, trackIds: ids("headliner_a", 2) },
      { tier: "headliner", billingRank: 2, trackIds: ids("headliner_b", 2) },
    ]);
    expect(out).toEqual([
      "headliner_a0",
      "headliner_b0",
      "headliner_c0",
      "headliner_a1",
      "headliner_b1",
      "headliner_c1",
    ]);
  });

  it("never puts one artist back to back when another artist's song is available", () => {
    const out = orderPlaylist([
      { tier: "mid", billingRank: 1, trackIds: ids("mid_x", 3) },
      { tier: "mid", billingRank: 2, trackIds: ids("mid_y", 3) },
      { tier: "mid", billingRank: 3, trackIds: ids("mid_z", 2) },
    ]);
    for (let i = 1; i < out.length; i += 1)
      expect(artistOf(out[i]!)).not.toBe(artistOf(out[i - 1]!));
  });

  it("keeps every track and handles an artist with zero picks", () => {
    const out = orderPlaylist([
      { tier: "headliner", billingRank: 1, trackIds: [] },
      { tier: "headliner", billingRank: 2, trackIds: ids("headliner_q", 3) },
    ]);
    expect(out).toEqual(ids("headliner_q", 3));
    expect(orderPlaylist([])).toEqual([]);
  });
});

describe("QA performance: 300-artist lineup", () => {
  it("selects and orders 300 artists quickly", () => {
    const tiers: BillingTier[] = ["headliner", "sub", "mid", "support"];
    const started = performance.now();
    const picked: ReturnType<typeof pickedTrack>[] = [];
    const all: ArtistPicks[] = [];
    for (let i = 0; i < 300; i += 1) {
      const artist = asSpotifyArtistId(`AR${String(i).padStart(20, "0")}`);
      const tier = tiers[i % 4]!;
      const s = sig({
        mostListened: many(`a${i} ml`, 10, artist),
        trending: many(`a${i} tr`, 5, artist),
        newest: many(`a${i} nw`, 5, artist),
        search: many(`a${i} se`, 10, artist),
      });
      const out = selectArtistTracks({ tier, artistId: artist, signals: s, alreadyPicked: picked });
      picked.push(...out.map(pickedTrack));
      all.push({ tier, billingRank: i, trackIds: out.map((x) => x.id) });
    }
    const order = orderPlaylist(all);
    expect(order.length).toBe(75 * (10 + 5 + 3 + 2));
    expect(new Set(order).size).toBe(order.length);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

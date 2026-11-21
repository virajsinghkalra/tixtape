import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import {
  AVG_SONG_MS,
  fillToBudget,
  planPlaylist,
  popularityFactor,
  summarizePlan,
  type PlannedArtistInput,
} from "./budget";

const lineup = (counts: Partial<Record<BillingTier, number>>, listeners: number | null = null) =>
  (Object.entries(counts) as [BillingTier, number][]).flatMap(([tier, n]) =>
    Array.from({ length: n }, (): PlannedArtistInput => ({ tier, listeners })),
  );
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("popularityFactor (log scale, 0.6–1.6)", () => {
  it.each([
    [null, 1],
    [0, 0.6],
    [1_000, 0.6],
    [2_000_000, 1.6],
    [50_000_000, 1.6],
    [-5, 1],
  ])("%s listeners → %s", (listeners, factor) => {
    expect(popularityFactor(listeners)).toBeCloseTo(factor, 5);
  });

  it("grows with listeners", () => {
    expect(popularityFactor(10_000)).toBeLessThan(popularityFactor(100_000));
    expect(popularityFactor(100_000)).toBeLessThan(popularityFactor(1_000_000));
  });
});

describe("planPlaylist", () => {
  it("a single-artist concert gives the artist the whole show (150 min ≈ 40 songs)", () => {
    const [only] = planPlaylist({
      artists: lineup({ headliner: 1 }),
      totalMinutes: 150,
      isSingleArtist: true,
    });
    expect(only).toEqual({ minutes: 150, songs: 40 });
  });

  it("splits a festival by tier weight 10/5/2.5/1 and fills the whole show", () => {
    const budgets = planPlaylist({
      artists: lineup({ headliner: 2, sub: 4, mid: 15, support: 13 }),
      totalMinutes: 960,
      isSingleArtist: false,
    });
    expect(sum(budgets.map((b) => b.minutes))).toBeCloseTo(960, 6);
    const [h, , s, , , , m] = budgets;
    expect(h!.minutes / s!.minutes).toBeCloseTo(2, 6);
    expect(s!.minutes / m!.minutes).toBeCloseTo(2, 6);
    const songs = sum(budgets.map((b) => b.songs));
    expect(songs).toBeGreaterThanOrEqual(220);
    expect(songs).toBeLessThanOrEqual(260);
  });

  it("popularity shifts time within a tier; missing popularity counts as 1.0", () => {
    const [big, unknown, small] = planPlaylist({
      artists: [
        { tier: "sub", listeners: 2_000_000 },
        { tier: "sub", listeners: null },
        { tier: "sub", listeners: 1_000 },
        { tier: "sub", listeners: null },
        { tier: "sub", listeners: null },
      ],
      totalMinutes: 300,
      isSingleArtist: false,
    });
    expect(big!.minutes / unknown!.minutes).toBeCloseTo(1.6, 6);
    expect(small!.minutes / unknown!.minutes).toBeCloseTo(0.6, 6);
  });

  it("raises tiny shares to the 2-song floor", () => {
    const budgets = planPlaylist({
      artists: lineup({ headliner: 1, support: 10 }, null),
      totalMinutes: 400,
      isSingleArtist: false,
    });
    for (const b of budgets.slice(1)) expect(b.minutes).toBeGreaterThanOrEqual(2 * 3.75);
    expect(sum(budgets.map((b) => b.minutes))).toBeCloseTo(400, 6);
  });

  it("drops the floor to 1 song for a huge lineup", () => {
    const budgets = planPlaylist({
      artists: lineup({ headliner: 1, support: 120 }),
      totalMinutes: 400,
      isSingleArtist: false,
    });
    expect(Math.min(...budgets.map((b) => b.songs))).toBe(1);
  });

  it("caps one artist at 40% of a multi-artist event and re-shares the rest", () => {
    const budgets = planPlaylist({
      artists: [{ tier: "headliner", listeners: 2_000_000 }, ...lineup({ support: 4 }, 1_000)],
      totalMinutes: 600,
      isSingleArtist: false,
    });
    expect(budgets[0]!.minutes).toBeCloseTo(240, 6);
    expect(sum(budgets.map((b) => b.minutes))).toBeCloseTo(600, 6);
  });

  it("splits evenly when two artists would both pass the cap", () => {
    const budgets = planPlaylist({
      artists: lineup({ headliner: 1, support: 1 }),
      totalMinutes: 240,
      isSingleArtist: false,
    });
    expect(budgets.map((b) => b.minutes)).toEqual([120, 120]);
  });

  it("returns nothing for no artists", () => {
    expect(planPlaylist({ artists: [], totalMinutes: 100, isSingleArtist: false })).toEqual([]);
  });
});

describe("summarizePlan", () => {
  it("totals songs and minutes per tier", () => {
    const artists = lineup({ headliner: 1, support: 2 });
    expect(
      summarizePlan(artists, [
        { minutes: 60, songs: 16 },
        { minutes: 10, songs: 3 },
        { minutes: 10.4, songs: 3 },
      ]),
    ).toEqual({
      songs: 22,
      minutes: 80,
      perTier: [
        { tier: "headliner", artists: 1, songs: 16, minutes: 60 },
        { tier: "support", artists: 2, songs: 6, minutes: 20 },
      ],
    });
  });
});

describe("fillToBudget", () => {
  const songs = (...minutes: number[]) =>
    minutes.map((m, i) => ({ id: i, durationMs: m * 60_000 }));
  const ids = (xs: { id: number }[]) => xs.map((x) => x.id);

  it.each<[string, number[], number, number[]]>([
    ["fills exactly", [4, 4, 4, 4], 12, [0, 1, 2]],
    ["adds a song that overshoots by up to half its length", [4, 4, 4], 10, [0, 1, 2]],
    ["stops before a song that would overshoot by more than half", [4, 4, 4], 5, [0]],
    ["stops in pool order rather than hunting for a shorter song", [4, 10, 2], 8, [0]],
    ["takes everything when the pool is short", [3, 3], 60, [0, 1]],
  ])("%s", (_n, minutes, budgetMinutes, expected) => {
    expect(ids(fillToBudget(songs(...minutes), budgetMinutes * 60_000))).toEqual(expected);
  });

  it("never overshoots by more than half the last song", () => {
    const pool = songs(3.2, 4.1, 5.5, 2.9, 3.7, 4.4, 6.1, 3.3);
    for (let budget = 1; budget <= 40; budget++) {
      const picked = fillToBudget(pool, budget * 60_000, 0);
      const used = sum(picked.map((t) => t.durationMs));
      const last = picked.at(-1);
      if (last) expect(used - budget * 60_000).toBeLessThanOrEqual(last.durationMs / 2);
    }
  });

  it("honours a minimum song count and uses the average length when unknown", () => {
    expect(ids(fillToBudget(songs(10, 10), 60_000, 2))).toEqual([0, 1]);
    expect(fillToBudget([{}, {}, {}], 2 * AVG_SONG_MS)).toHaveLength(2);
  });
});

describe("planPlaylist keeps every minute allocated", () => {
  it.each([
    [["headliner", "support"], 60],
    [["headliner", "sub", "support"], 60],
    [["headliner", "headliner", "support", "support", "support"], 120],
    [["headliner", "mid", "mid", "support"], 30],
  ] as [BillingTier[], number][])("%j over %i min", (tiers, total) => {
    const budgets = planPlaylist({
      artists: tiers.map((tier) => ({ tier, listeners: null })),
      totalMinutes: total,
      isSingleArtist: false,
    });
    expect(sum(budgets.map((b) => b.minutes))).toBeCloseTo(total, 6);
  });
});

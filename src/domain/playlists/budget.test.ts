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

describe("planPlaylist (D-093 tier minutes)", () => {
  const plan = (artists: PlannedArtistInput[], totalMinutes: number, isSingleArtist = false) =>
    planPlaylist({ artists, totalMinutes, isSingleArtist });
  const minutes = (b: { minutes: number }[]) => b.map((x) => Math.round(x.minutes * 10) / 10);
  const total = (b: { minutes: number }[]) => sum(b.map((x) => x.minutes));

  it.each([
    ["a default solo show (2 h 30 m)", 150, 150],
    ["a solo show with real times (2 h)", 120, 120],
    ["a very short solo slot still makes an hour", 30, 60],
  ])("1 artist: %s → %i min", (_n, show, expected) => {
    const [only] = plan(lineup({ headliner: 1 }), show, true);
    expect(only!.minutes).toBe(expected);
  });

  it("2 artists: ≥ 2 h together, headliner 60–90 min, the other act 30–45 min", () => {
    for (const second of ["sub", "mid", "support"] as const) {
      const [h, other] = plan([...lineup({ headliner: 1 }), ...lineup({ [second]: 1 })], 150);
      expect(h!.minutes).toBeGreaterThanOrEqual(60);
      expect(h!.minutes).toBeLessThanOrEqual(90);
      expect(other!.minutes).toBeGreaterThanOrEqual(30);
      expect(other!.minutes).toBeLessThanOrEqual(45);
      expect(h!.minutes + other!.minutes).toBeGreaterThanOrEqual(120);
    }
    // Billing order decides who is the headliner, whichever is listed first.
    const [support, head] = plan([...lineup({ support: 1 }), ...lineup({ headliner: 1 })], 150);
    expect(head!.minutes).toBeGreaterThan(support!.minutes);
  });

  it("a small festival sums the tier targets when they fit the show", () => {
    const budgets = plan(lineup({ headliner: 1, sub: 1, mid: 1, support: 1 }), 480);
    expect(minutes(budgets)).toEqual([75, 45, 30, 17.5]);
    expect(total(budgets)).toBeCloseTo(167.5, 6); // not 4 × 1 h, and not the whole 8 h day
  });

  it("HOME (2/4/15/13 over 2 × 8 h): capped at 16 h, support trimmed first", () => {
    const budgets = plan(lineup({ headliner: 2, sub: 4, mid: 15, support: 13 }), 960);
    expect(total(budgets)).toBeCloseTo(960, 6);
    const [h, , , , , , m] = budgets;
    expect(h!.minutes).toBe(75);
    expect(budgets[2]!.minutes).toBe(45);
    expect(m!.minutes).toBe(30);
    const support = budgets.at(-1)!.minutes;
    expect(support).toBeLessThan(17.5);
    expect(support).toBeGreaterThanOrEqual(2 * 3.75);
    const songs = sum(budgets.map((b) => b.songs));
    expect(songs).toBeGreaterThanOrEqual(240);
    expect(songs).toBeLessThanOrEqual(260);
  });

  it("Lolla (45 acts, 2 days): capped at the show, headliners keep ≥ 45 min, bottom tiers shrink first", () => {
    const budgets = plan(lineup({ headliner: 4, sub: 8, mid: 15, support: 18 }), 960);
    expect(total(budgets)).toBeCloseTo(960, 6);
    const byTier = (t: BillingTier) =>
      budgets.filter(
        (_, i) => lineup({ headliner: 4, sub: 8, mid: 15, support: 18 })[i]!.tier === t,
      );
    for (const h of byTier("headliner")) expect(h.minutes).toBe(75);
    for (const s of byTier("sub")) expect(s.minutes).toBe(45);
    for (const s of byTier("support")) expect(s.minutes).toBeCloseTo(7.5, 6);
    for (const m of byTier("mid")) {
      expect(m.minutes).toBeGreaterThanOrEqual(10);
      expect(m.minutes).toBeLessThan(30);
    }
  });

  it("a lineup too big for the show shrinks every tier, headliners last and ≥ 45 min", () => {
    const budgets = plan(lineup({ headliner: 6, sub: 10, mid: 30, support: 40 }), 480);
    for (const b of budgets.slice(0, 6)) expect(b.minutes).toBeGreaterThanOrEqual(45 - 1e-6);
    // 86 acts can't fit 8 h with ≥ 45 min headliners: everyone else scales down evenly, to at
    // least one song, keeping billing order (sub ≥ mid ≥ support).
    for (const b of budgets.slice(6)) expect(b.minutes).toBeGreaterThanOrEqual(3.75 - 1e-6);
    const [sub, midAct, support] = [budgets[6]!, budgets[16]!, budgets[85]!].map((b) => b.minutes);
    expect(sub).toBeGreaterThanOrEqual(midAct!);
    expect(midAct).toBeGreaterThanOrEqual(support!);
  });

  it("popularity only moves time within a tier, inside the tier's range", () => {
    const budgets = plan(
      [
        { tier: "sub", listeners: 2_000_000 },
        { tier: "sub", listeners: 1_000 },
        { tier: "support", listeners: 2_000_000 },
        { tier: "support", listeners: null },
      ],
      480,
    );
    const [famous, niche, bigSupport] = budgets;
    expect(famous!.minutes).toBeGreaterThan(niche!.minutes);
    expect(famous!.minutes).toBeLessThanOrEqual(50);
    expect(niche!.minutes).toBeGreaterThanOrEqual(40);
    expect(bigSupport!.minutes).toBeLessThanOrEqual(20); // a famous support act stays support
  });

  it("is never under an hour in all", () => {
    const budgets = plan(lineup({ mid: 1, support: 2 }), 480);
    expect(total(budgets)).toBeGreaterThanOrEqual(60);
  });

  it("returns nothing for no artists", () => {
    expect(plan([], 100)).toEqual([]);
  });
});

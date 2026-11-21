/**
 * Demand-driven discovery (D-081). Pure: callers pass counts in, plans come out.
 * - Demand per metro: page views and searches by visitor city, a daily count per city only
 *   (never an IP or a user), decayed with a 7-day half-life over 14 days. Cities fold into the
 *   home page's metro clusters (`metroOf`, D-079): demand in Thane is demand for Mumbai.
 * - Budget: the top-demand metros share (1 − floor) of a run's artist slots in proportion to
 *   demand; the floor (default 30%) keeps rotating through everyone else, so new markets are
 *   still covered.
 * - Scarcity: a top metro with fewer than 5 upcoming published shows is served first.
 */
import { findCity } from "../events/extract/places";
import { metroOf } from "../events/front-page";
import { isoDate } from "./extract";
import { normalizeArtistName } from "../shared/normalize";
import { pickForRun, type WatchArtist } from "./watchlist";

const DAY_MS = 86_400_000;
export const DEMAND_WINDOW_DAYS = 14;
const HALF_LIFE_DAYS = 7;
/** A search says more about intent than a page view. */
const SEARCH_WEIGHT = 3;
export const DEFAULT_TOP_METROS = 3;
export const DEFAULT_FLOOR_SHARE = 0.3;
export const SCARCE_BELOW = 5;

export const DEMAND_KINDS = ["view", "search"] as const;
export type DemandKind = (typeof DEMAND_KINDS)[number];

export type DemandCount = { day: string; city: string; kind: DemandKind; count: number };

export type MetroDemand = { metro: string; cities: string[]; score: number };

/** Demand per metro, highest first. `day` is an IST calendar date "YYYY-MM-DD". */
export function metroDemand(rows: readonly DemandCount[], now: Date): MetroDemand[] {
  const byMetro = new Map<string, MetroDemand>();
  const today = Date.parse(`${isoDate(now)}T00:00:00+05:30`);
  for (const r of rows) {
    // Whole IST days: today's counts are fresh, yesterday's are one day old.
    const age = Math.round((today - Date.parse(`${r.day}T00:00:00+05:30`)) / DAY_MS);
    if (!Number.isFinite(age) || age < -1 || age > DEMAND_WINDOW_DAYS || r.count <= 0) continue;
    const weight =
      (r.kind === "search" ? SEARCH_WEIGHT : 1) * 0.5 ** (Math.max(age, 0) / HALF_LIFE_DAYS);
    const metro = metroOf(r.city);
    const entry = byMetro.get(metro) ?? { metro, cities: [], score: 0 };
    entry.score += r.count * weight;
    if (!entry.cities.includes(r.city)) entry.cities.push(r.city);
    byMetro.set(metro, entry);
  }
  return [...byMetro.values()]
    .map((m) => ({ ...m, score: Math.round(m.score * 100) / 100 }))
    .sort((a, b) => b.score - a.score || a.metro.localeCompare(b.metro));
}

export type MetroPlan = MetroDemand & {
  /** Upcoming published shows in the metro. */
  upcoming: number;
  scarce: boolean;
  /** Artist slots this run. */
  slots: number;
};

export type RunPlan = { metros: MetroPlan[]; floorSlots: number };

/**
 * Splits `perRun` slots: top metros get a demand-proportional share of (1 − floorShare), the
 * rest is the floor. Scarce metros (fewer than 5 upcoming shows) come first, then by demand.
 * Every top metro gets at least one slot while slots remain.
 */
export function planRun(
  demand: readonly MetroDemand[],
  upcomingByCity: ReadonlyArray<{ city: string; count: number }>,
  perRun: number,
  opts: { topMetros?: number; floorShare?: number; scarceBelow?: number } = {},
): RunPlan {
  const topN = opts.topMetros ?? DEFAULT_TOP_METROS;
  const floorShare = Math.min(Math.max(opts.floorShare ?? DEFAULT_FLOOR_SHARE, 0), 1);
  const scarceBelow = opts.scarceBelow ?? SCARCE_BELOW;
  const upcoming = new Map<string, number>();
  for (const u of upcomingByCity) {
    const m = metroOf(u.city);
    upcoming.set(m, (upcoming.get(m) ?? 0) + u.count);
  }
  const top = demand.filter((d) => d.score > 0).slice(0, topN);
  const budget = Math.max(0, Math.floor(perRun));
  const demandSlots = top.length === 0 ? 0 : Math.round(budget * (1 - floorShare));
  const total = top.reduce((s, d) => s + d.score, 0);
  const metros: MetroPlan[] = top.map((d) => {
    const count = upcoming.get(d.metro) ?? 0;
    return {
      ...d,
      upcoming: count,
      scarce: count < scarceBelow,
      slots: total > 0 ? Math.floor((demandSlots * d.score) / total) : 0,
    };
  });
  // Leftovers from rounding go to the neediest metros; each top metro gets ≥ 1 slot if possible.
  let left = demandSlots - metros.reduce((s, m) => s + m.slots, 0);
  const order = [...metros].sort(byNeed);
  for (const m of order) {
    if (left > 0 && m.slots === 0) {
      m.slots++;
      left--;
    }
  }
  for (let i = 0; left > 0 && order.length > 0; i++) {
    order[i % order.length]!.slots++;
    left--;
  }
  return { metros: metros.sort(byNeed), floorSlots: budget - demandSlots };
}

const byNeed = (a: MetroPlan, b: MetroPlan) =>
  Number(b.scarce) - Number(a.scarce) ||
  (a.scarce && b.scarce ? a.upcoming - b.upcoming : 0) ||
  b.score - a.score ||
  a.metro.localeCompare(b.metro);

export type PlannedArtist = WatchArtist & {
  /** Cities to name in this artist's search (their demand metro's cities), if any. */
  focusCities: string[];
  /** Why the artist is in this run: "searched", a metro, or "floor". */
  reason: string;
};

/**
 * This run's artists under a plan:
 *  1. scarce metros (fewer than 5 upcoming shows), neediest first: artists who have played or
 *     will play there (`artistCities`), best-scored first, up to the metro's slots;
 *  2. every searched artist (direct demand);
 *  3. the other planned metros, the same way;
 *  4. the floor plus any slots a metro couldn't fill: the usual rotation over the rest.
 * Without demand data this is exactly `pickForRun`.
 */
export function pickByDemand(
  list: readonly WatchArtist[],
  artistCities: ReadonlyArray<{ name: string; city: string }>,
  plan: RunPlan,
  perRun: number,
  runIndex: number,
): PlannedArtist[] {
  if (plan.metros.length === 0) {
    return pickForRun(list, perRun, runIndex).map((a) => ({
      ...a,
      focusCities: [],
      reason: a.origins.includes("searched") ? "searched" : "floor",
    }));
  }
  const metrosOf = new Map<string, Set<string>>();
  for (const { name, city } of artistCities) {
    const key = normalizeArtistName(name);
    metrosOf.set(key, (metrosOf.get(key) ?? new Set()).add(metroOf(city)));
  }
  const out: PlannedArtist[] = [];
  const taken = new Set<string>();
  const take = (a: WatchArtist, focusCities: string[], reason: string) => {
    taken.add(a.key);
    out.push({ ...a, focusCities, reason });
  };
  let spare = 0;
  const serve = (m: MetroPlan) => {
    let slots = m.slots;
    for (const a of list) {
      if (slots <= 0 || out.length >= perRun) break;
      if (taken.has(a.key) || !metrosOf.get(a.key)?.has(m.metro)) continue;
      take(a, m.cities, m.metro);
      slots--;
    }
    spare += slots;
  };
  // Scarce metros first (few shows where people are looking), then searched artists, then
  // the other planned metros, then the floor.
  for (const m of plan.metros) if (m.scarce) serve(m);
  for (const a of list) {
    if (out.length >= perRun) break;
    if (!taken.has(a.key) && a.origins.includes("searched")) {
      take(a, focusFor(a, metrosOf, plan), "searched");
    }
  }
  for (const m of plan.metros) if (!m.scarce) serve(m);
  const rest = list.filter((a) => !taken.has(a.key));
  const floor = Math.min(plan.floorSlots + spare, perRun - out.length);
  for (const a of pickForRun(rest, floor, runIndex)) take(a, [], "floor");
  return out;
}

/** The searched artist's focus: their planned metro's cities, if they play one. */
function focusFor(a: WatchArtist, metrosOf: Map<string, Set<string>>, plan: RunPlan): string[] {
  const mine = metrosOf.get(a.key);
  const m = plan.metros.find((p) => mine?.has(p.metro)) ?? plan.metros[0];
  return m?.cities ?? [];
}

/** Listing pages (e.g. HighApe city slugs) in demand order; the others follow as the floor. */
export function orderByDemand<T>(
  items: readonly T[],
  cityOf: (item: T) => string,
  plan: RunPlan,
): T[] {
  const rank = new Map(plan.metros.map((m, i) => [m.metro, i] as const));
  const last = plan.metros.length;
  const r = (item: T) => rank.get(metroOf(cityOf(item))) ?? last;
  // Stable sort: items outside the plan keep their order after the planned ones.
  return [...items].sort((a, b) => r(a) - r(b));
}

/**
 * Listing pages for this run (e.g. HighApe city pages): every page in a planned metro, in need
 * order, plus `floor` of the others, rotating by `runIndex`. Without a plan: all of them.
 */
export function listingsForRun<T>(
  items: readonly T[],
  cityOf: (item: T) => string,
  plan: RunPlan,
  floor: number,
  runIndex: number,
): T[] {
  if (plan.metros.length === 0) return [...items];
  const planned = new Set(plan.metros.map((m) => m.metro));
  const ordered = orderByDemand(items, cityOf, plan);
  const inPlan = ordered.filter((i) => planned.has(metroOf(cityOf(i))));
  const rest = ordered.filter((i) => !planned.has(metroOf(cityOf(i))));
  if (rest.length === 0 || floor <= 0) return inPlan;
  const start = (Math.max(0, Math.floor(runIndex)) * floor) % rest.length;
  const extra = Array.from(
    { length: Math.min(floor, rest.length) },
    (_, i) => rest[(start + i) % rest.length]!,
  );
  return [...inPlan, ...extra];
}

/**
 * The city to count demand for, or null: only known Indian cities (canonical names), so a
 * hand-made cookie can't add arbitrary rows and nothing identifying is ever stored.
 */
export function demandCity(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return findCity(raw) ?? null;
}

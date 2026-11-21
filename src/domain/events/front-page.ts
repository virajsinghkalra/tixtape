/**
 * The ranked, location-aware home page (D-079). Pure: no IO, no clock (`now` is passed in).
 *   score = size × proximity × timing
 * Sections: Near you · The big ones · This week · Just announced · Tours.
 * One card per tour, at most 2 cards per city or headliner in a section, and a card appears in
 * one section only (the story strip may reuse them).
 */
import type { EventType } from "@/domain/shared/lineup";

const DAY_MS = 86_400_000;

/** What ranking needs to know about an upcoming, published event. */
export type FeedEvent = {
  id: string;
  title: string;
  type: EventType;
  startsAt: Date;
  endsAt: Date | null;
  city: string | null;
  artistCount: number;
  /** Headliner names in billing order. */
  headliners: string[];
  /** The best-known headliner's Last.fm listeners; null when unknown (neutral). */
  headlinerListeners: number | null;
  sourceCount: number;
  views: number;
  playlistOpens: number;
  createdAt: Date;
};

// ── Size ─────────────────────────────────────────────────────────────────

/** Unknown popularity counts like ~25k listeners: it neither boosts nor buries an event. */
export const NEUTRAL_POPULARITY = 0.35;

/**
 * 0–1 from Last.fm listeners on a log scale: 1k → 0, 10k → 0.25, 100k → 0.5, 1M → 0.75,
 * 10M → 1. Spread wide enough that a 2M-listener headliner clearly beats a 20k club night.
 * No regional bias: Arijit or Diljit can outrank anyone.
 */
export function popularityFactor(listeners: number | null): number {
  if (listeners === null || listeners < 0) return NEUTRAL_POPULARITY;
  return Math.min(Math.max((Math.log10(listeners + 1) - 3) / 4, 0), 1);
}

/** Engagement only starts to matter once traffic exists, and is capped. */
export function engagementBonus(views: number, playlistOpens: number): number {
  const signal = Math.log10(1 + Math.max(0, views) + 5 * Math.max(0, playlistOpens)) / 3;
  return 0.15 * Math.min(signal, 1);
}

export function sizeScore(e: FeedEvent): number {
  const festival = e.type === "festival" ? 0.6 : 0;
  const lineup = 0.3 * Math.min(Math.log2(Math.max(e.artistCount, 1)) / 6, 1);
  const sources = 0.05 * Math.min(Math.max(e.sourceCount - 1, 0), 3);
  return (
    1 +
    3 * popularityFactor(e.headlinerListeners) +
    festival +
    lineup +
    sources +
    engagementBonus(e.views, e.playlistOpens)
  );
}

// ── Proximity ────────────────────────────────────────────────────────────

/** Metro clusters: a gig in Pune is "near" for someone in Mumbai. Keys are lower-case. */
const METRO: Record<string, string> = {
  mumbai: "mumbai",
  "navi mumbai": "mumbai",
  thane: "mumbai",
  pune: "mumbai",
  delhi: "delhi",
  "new delhi": "delhi",
  "delhi ncr": "delhi",
  gurugram: "delhi",
  gurgaon: "delhi",
  noida: "delhi",
  "greater noida": "delhi",
  ghaziabad: "delhi",
  faridabad: "delhi",
  bengaluru: "bengaluru",
  bangalore: "bengaluru",
  hyderabad: "hyderabad",
  secunderabad: "hyderabad",
  chennai: "chennai",
  kolkata: "kolkata",
  goa: "goa",
  "north goa": "goa",
  "south goa": "goa",
  panaji: "goa",
  vagator: "goa",
  ahmedabad: "ahmedabad",
  gandhinagar: "ahmedabad",
  chandigarh: "chandigarh",
  mohali: "chandigarh",
  panchkula: "chandigarh",
  jaipur: "jaipur",
  lucknow: "lucknow",
  indore: "indore",
  kochi: "kochi",
  cochin: "kochi",
  guwahati: "guwahati",
  shillong: "shillong",
  bhubaneswar: "bhubaneswar",
};

const norm = (city: string) => city.trim().toLowerCase();

/** The metro a city belongs to (itself when it isn't in a cluster). */
export function metroOf(city: string): string {
  const c = norm(city);
  return METRO[c] ?? c;
}

/** 1.0 same city · 0.7 same metro · 0.3 elsewhere · 1.0 for everything when the city is unknown. */
export function proximity(eventCity: string | null, visitorCity: string | null): number {
  if (!visitorCity) return 1;
  if (!eventCity) return 0.3;
  if (norm(eventCity) === norm(visitorCity)) return 1;
  return metroOf(eventCity) === metroOf(visitorCity) ? 0.7 : 0.3;
}

// ── Timing ───────────────────────────────────────────────────────────────

/** 1.0 this week · 0.9 within 30 days · 0.75 within 90 · 0.55 beyond · null once it's over. */
export function timing(startsAt: Date, endsAt: Date | null, now: Date): number | null {
  if ((endsAt ?? startsAt).getTime() < now.getTime()) return null;
  const days = (startsAt.getTime() - now.getTime()) / DAY_MS;
  if (days <= 7) return 1;
  if (days <= 30) return 0.9;
  if (days <= 90) return 0.75;
  return 0.55;
}

export function score(e: FeedEvent, visitorCity: string | null, now: Date): number | null {
  const t = timing(e.startsAt, e.endsAt, now);
  return t === null ? null : sizeScore(e) * proximity(e.city, visitorCity) * t;
}

// ── Tours ────────────────────────────────────────────────────────────────

const TOUR_WINDOW_DAYS = 90;

/** "Martin Garrix India Tour 2027 – Mumbai" → "Martin Garrix India Tour 2027". */
export function titleStem(title: string): string {
  return title.split(/\s[–—-]\s/)[0]!.trim();
}

export type Tour<T extends FeedEvent> = {
  key: string;
  title: string;
  /** Soonest first. */
  events: T[];
  cityCount: number;
  /** The date to show this visitor: in their city, else their metro, else the next one. */
  featured: T;
};

export type FrontItem<T extends FeedEvent> =
  { kind: "event"; event: T; score: number } | { kind: "tour"; tour: Tour<T>; score: number };

function tourKey(e: FeedEvent): string {
  const headliners = [...e.headliners].map(norm).sort().join("+");
  return `${norm(titleStem(e.title))}|${headliners}`;
}

/** The member to feature for this visitor. */
export function featuredDate<T extends FeedEvent>(
  events: readonly T[],
  visitorCity: string | null,
): T {
  const soonest = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (visitorCity) {
    const here = soonest.find((e) => e.city && norm(e.city) === norm(visitorCity));
    if (here) return here;
    const metro = soonest.find((e) => e.city && metroOf(e.city) === metroOf(visitorCity));
    if (metro) return metro;
  }
  return soonest[0]!;
}

/**
 * Same headliners and title stem within ~90 days → one tour card. A lone event stays an event.
 * Scores are this visitor's: a tour scores as its best member.
 */
export function groupTours<T extends FeedEvent>(
  events: readonly T[],
  visitorCity: string | null,
  now: Date,
): FrontItem<T>[] {
  const scored = events
    .map((e) => ({ e, s: score(e, visitorCity, now) }))
    .filter((x): x is { e: T; s: number } => x.s !== null);
  const byKey = new Map<string, { e: T; s: number }[]>();
  for (const x of [...scored].sort((a, b) => a.e.startsAt.getTime() - b.e.startsAt.getTime())) {
    const key = tourKey(x.e);
    const groups = [...byKey.keys()].filter((k) => k.startsWith(`${key}#`));
    const open = groups.find((k) => {
      const first = byKey.get(k)![0]!.e;
      return (x.e.startsAt.getTime() - first.startsAt.getTime()) / DAY_MS <= TOUR_WINDOW_DAYS;
    });
    if (open) byKey.get(open)!.push(x);
    else byKey.set(`${key}#${groups.length}`, [x]);
  }
  return [...byKey.entries()].map(([key, members]) => {
    if (members.length === 1) return { kind: "event", event: members[0]!.e, score: members[0]!.s };
    const events = members.map((m) => m.e);
    const tour: Tour<T> = {
      key,
      title: titleStem(events[0]!.title),
      events,
      cityCount: new Set(events.map((e) => (e.city ? norm(e.city) : e.id))).size,
      featured: featuredDate(events, visitorCity),
    };
    return { kind: "tour", tour, score: Math.max(...members.map((m) => m.s)) };
  });
}

// ── Diversity ────────────────────────────────────────────────────────────

/** The event an item is shown as (a tour shows its featured date). */
export function leadEvent<T extends FeedEvent>(item: FrontItem<T>): T {
  return item.kind === "event" ? item.event : item.tour.featured;
}

export function itemKey(item: FrontItem<FeedEvent>): string {
  return item.kind === "event" ? item.event.id : item.tour.key;
}

/**
 * Keeps order, skipping items once their city (exact) or headliner already has `cap` cards.
 * `cityCap: false` drops the city cap: in "Near you" the city is the whole point.
 */
export function diversify<T extends FeedEvent>(
  items: readonly FrontItem<T>[],
  limit: number,
  { cap = 2, cityCap = true }: { cap?: number; cityCap?: boolean } = {},
): FrontItem<T>[] {
  const cities = new Map<string, number>();
  const headliners = new Map<string, number>();
  const out: FrontItem<T>[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const lead = leadEvent(item);
    const city = cityCap && lead.city ? norm(lead.city) : null;
    const names = lead.headliners.map(norm);
    if (city && (cities.get(city) ?? 0) >= cap) continue;
    if (names.some((n) => (headliners.get(n) ?? 0) >= cap)) continue;
    out.push(item);
    if (city) cities.set(city, (cities.get(city) ?? 0) + 1);
    for (const n of names) headliners.set(n, (headliners.get(n) ?? 0) + 1);
  }
  return out;
}

// ── The page ─────────────────────────────────────────────────────────────

export const LIMITS = { nearYou: 6, bigOnes: 5, thisWeek: 8, justAnnounced: 8 } as const;

export type FrontPage<T extends FeedEvent> = {
  nearYou: FrontItem<T>[];
  bigOnes: FrontItem<T>[];
  thisWeek: FrontItem<T>[];
  justAnnounced: FrontItem<T>[];
  tours: Tour<T>[];
};

export function buildFrontPage<T extends FeedEvent>(
  events: readonly T[],
  opts: { now: Date; city: string | null },
): FrontPage<T> {
  const { now, city } = opts;
  const items = groupTours(events, city, now);
  const used = new Set<string>();
  const take = (list: FrontItem<T>[], limit: number, cityCap = true) => {
    const picked = diversify(
      list.filter((i) => !used.has(itemKey(i))),
      limit,
      { cityCap },
    );
    picked.forEach((i) => used.add(itemKey(i)));
    return picked;
  };
  const byScore = (a: FrontItem<T>, b: FrontItem<T>) => b.score - a.score;
  // Size × timing only: the big ones are big for everyone.
  const national = (i: FrontItem<T>) => {
    const lead = leadEvent(i);
    return sizeScore(lead) * (timing(lead.startsAt, lead.endsAt, now) ?? 0);
  };

  const local = city
    ? items.filter((i) => {
        const members = i.kind === "event" ? [i.event] : i.tour.events;
        return members.some((e) => proximity(e.city, city) >= 0.7);
      })
    : [];
  const nearYou = take([...local].sort(byScore), LIMITS.nearYou, false);
  const bigOnes = take(
    [...items].sort((a, b) => national(b) - national(a)),
    LIMITS.bigOnes,
  );
  const thisWeek = take(
    items
      .filter((i) => timing(leadEvent(i).startsAt, leadEvent(i).endsAt, now) === 1)
      .sort((a, b) => leadEvent(a).startsAt.getTime() - leadEvent(b).startsAt.getTime()),
    LIMITS.thisWeek,
  );
  const newest = (i: FrontItem<T>) =>
    Math.max(...(i.kind === "event" ? [i.event] : i.tour.events).map((e) => e.createdAt.getTime()));
  const justAnnounced = take(
    [...items].sort((a, b) => newest(b) - newest(a)),
    LIMITS.justAnnounced,
  );
  const tours = items
    .filter((i): i is Extract<FrontItem<T>, { kind: "tour" }> => i.kind === "tour")
    .sort(byScore)
    .map((i) => i.tour);
  return { nearYou, bigOnes, thisWeek, justAnnounced, tours };
}

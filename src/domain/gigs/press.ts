/**
 * Press confirmation (D-087, D-089): the reputable outlets, in one place, and the rules for
 * counting independent articles. Pure.
 * - Only outlets we may also **read** count: we ground every fact on the article text we fetch
 *   ourselves, so an outlet whose terms forbid automated reading (D-033, D-073 research) can
 *   never contribute, even though it's reputable.
 * - Independence: different publishers; copies of one wire story (PTI/ANI/IANS byline) count
 *   once; syndicated copies of one press release (same opening text) count once.
 */
import { textFingerprint } from "../events/extract/article";
import type { GigProvenance } from "./provenance";
import { registrableDomain } from "./registrable-domain";

export type PressOutlet = {
  domain: string;
  name: string;
  /** robots.txt and terms allow us to fetch the article (checked 2026-11-22). */
  readable: boolean;
};

/** The D-087 list. `readable: false` outlets are listed so the reason is on record. */
export const PRESS_OUTLETS: readonly PressOutlet[] = [
  { domain: "rollingstoneindia.com", name: "Rolling Stone India", readable: true },
  { domain: "pollstar.com", name: "Pollstar", readable: true },
  { domain: "esquireindia.co.in", name: "Esquire India", readable: true },
  { domain: "djmag.com", name: "DJ Mag", readable: true },
  { domain: "indianexpress.com", name: "The Indian Express", readable: true },
  { domain: "mid-day.com", name: "Mid-day", readable: true },
  { domain: "hollywoodreporterindia.com", name: "The Hollywood Reporter India", readable: true },
  { domain: "theprint.in", name: "ThePrint", readable: true },
  // Terms forbid automated access (D-033 / D-089 research): never read, never counted.
  { domain: "hindustantimes.com", name: "Hindustan Times", readable: false },
  { domain: "thehindu.com", name: "The Hindu", readable: false },
  { domain: "timeout.com", name: "Time Out India", readable: false },
  { domain: "livemint.com", name: "Mint", readable: false },
  { domain: "billboard.com", name: "Billboard", readable: false },
  // Terms not readable by a script (bot-blocked or not found): not read until checked by hand.
  { domain: "indiatimes.com", name: "The Times of India", readable: false },
  { domain: "ndtv.com", name: "NDTV", readable: false },
  { domain: "businesstoday.in", name: "Business Today", readable: false },
];

/** The press outlet for a URL (by registrable domain), or null. */
export function pressOutlet(url: string): PressOutlet | null {
  const domain = registrableDomain(url);
  return PRESS_OUTLETS.find((o) => o.domain === domain) ?? null;
}

export const WIRE_AGENCIES = ["PTI", "ANI", "IANS", "Reuters", "AFP", "AP"] as const;
export type WireAgency = (typeof WIRE_AGENCIES)[number];

/**
 * The wire agency behind an article, from its byline or dateline: "By PTI", "(PTI)",
 * "— IANS", "Agency: ANI", "Mumbai, Dec 1 (PTI)". Null for the outlet's own reporting.
 */
export function detectWire(byline: string | null, text: string): WireAgency | null {
  const head = `${byline ?? ""}\n${text.slice(0, 600)}`;
  for (const agency of WIRE_AGENCIES) {
    const a = agency.replace(/\./gu, "\\.");
    const patterns = [
      new RegExp(`\\bby\\s+${a}\\b`, "u"),
      new RegExp(`\\(${a}\\)`, "u"),
      new RegExp(`[—–-]\\s*${a}\\s*$`, "mu"),
      new RegExp(`\\bagency\\s*:\\s*${a}\\b`, "iu"),
      new RegExp(`^\\s*${a}\\s*$`, "mu"),
    ];
    if (patterns.some((p) => p.test(head))) return agency;
  }
  return null;
}

export type PressArticleRef = {
  url: string;
  /** Registrable domain of the publisher. */
  domain: string;
  wire: string | null;
  /** Opening-text fingerprint: syndicated copies share it. */
  fingerprint: string;
};

/**
 * How many independent articles there are: articles are joined when they share a publisher,
 * a wire agency, or an opening-text fingerprint (transitively). Returns the groups.
 */
export function independentArticles<T extends PressArticleRef>(articles: readonly T[]): T[][] {
  const parent = articles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const keysOf = (a: T) => [
    `domain:${a.domain}`,
    `fp:${a.fingerprint}`,
    ...(a.wire ? [`wire:${a.wire}`] : []),
  ];
  const owner = new Map<string, number>();
  articles.forEach((a, i) => {
    for (const key of keysOf(a)) {
      const j = owner.get(key);
      if (j === undefined) owner.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, T[]>();
  articles.forEach((a, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), a]));
  return [...groups.values()];
}

/**
 * Press facts for a fetched article on a readable D-087 outlet, or undefined for any other
 * page. `published` must carry a timezone offset (pages without one are read as IST).
 */
export function pressMeta(page: {
  url: string;
  text: string;
  published: string | null;
  byline: string | null;
}): GigProvenance["press"] | undefined {
  const outlet = pressOutlet(page.url);
  if (!outlet?.readable) return undefined;
  return {
    publisher: outlet.name,
    publishedAt: normalizePublished(page.published),
    wire: detectWire(page.byline, page.text),
    fingerprint: textFingerprint(page.text),
  };
}

/** An ISO date-time with offset, or null: "2026-11-01T10:00:00" is read as IST. */
export function normalizePublished(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/u.test(value)
    ? value
    : /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? `${value}T00:00:00+05:30`
      : `${value}+05:30`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

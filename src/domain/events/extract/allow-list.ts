/**
 * Which web pages the doubt resolver may read (D-064). One place for the data:
 * - official organiser and festival sites count as `official`;
 * - reputable outlets that allow automated use count as `trusted`;
 * - sites whose terms forbid automated collection, or social and ticketing sites, are denied
 *   even if a search returns them (D-008, D-033).
 */
import type { CollectorSource, SourceTrust } from "./candidate";

export type AllowedDomain = {
  domain: string;
  trust: SourceTrust;
  /** Our adapter's source for this site, when we have one; otherwise the page is a "web" source. */
  source?: CollectorSource;
};

export const ALLOWED_DOMAINS: readonly AllowedDomain[] = [
  { domain: "sunburn.in", trust: "official", source: "sunburn" },
  { domain: "teaminnovation.in", trust: "official", source: "teaminnovation" },
  { domain: "lollaindia.com", trust: "official" },
  { domain: "nh7.in", trust: "official" },
  { domain: "magneticfields.in", trust: "official" },
  { domain: "zirofestival.com", trust: "official" },
  { domain: "rollingstoneindia.com", trust: "trusted", source: "rollingstone" },
  { domain: "pollstar.com", trust: "trusted", source: "pollstar" },
  { domain: "djmag.com", trust: "trusted" },
  // robots.txt allows all but /search; terms bar reproducing content, not reading it.
  // We keep facts and a link only (checked 2026-11-21).
  { domain: "esquireindia.co.in", trust: "trusted" },
  // D-070: anyone can edit it, so it is a trusted outlet, not official; English only.
  { domain: "en.wikipedia.org", trust: "trusted", source: "wikipedia" },
  // D-073: robots allows city and event pages; terms have no automated-access clause.
  { domain: "highape.com", trust: "trusted", source: "highape" },
  // D-089: readable D-087 press outlets (robots allows articles; terms have no ban; D-033 list).
  { domain: "indianexpress.com", trust: "trusted" },
  { domain: "mid-day.com", trust: "trusted" },
  { domain: "hollywoodreporterindia.com", trust: "trusted" },
  { domain: "theprint.in", trust: "trusted" },
];

export const DENIED_DOMAINS: readonly string[] = [
  "instagram.com",
  "facebook.com",
  "bookmyshow.com",
  "district.in",
  "timeout.com",
  "thehindu.com",
  "hindustantimes.com",
  // D-073 research (docs/research/gig-sources.md): terms or robots forbid automated access.
  "insider.in",
  "allevents.in",
  "linktr.ee",
  "songkick.com",
  "bandsintown.com",
  "shazam.com",
  "music.apple.com",
  "x.com",
  "twitter.com",
  // D-089 research: terms forbid robots/spiders/scraping.
  "livemint.com",
  "billboard.com",
];

const matches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** The allow-list entry for a URL, or null when it's denied, unknown or not http(s). */
export function allowedDomain(url: string): AllowedDomain | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (DENIED_DOMAINS.some((d) => matches(host, d))) return null;
  return ALLOWED_DOMAINS.find((d) => matches(host, d.domain)) ?? null;
}

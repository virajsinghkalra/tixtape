import { ALLOWED_DOMAINS } from "@/domain/events/extract/allow-list";
import type { SpotifyArtistId } from "@/domain/shared/ids";

export const SPOTIFY_LOGIN_URL = "/api/auth/spotify/login";

export function spotifyArtistUrl(id: SpotifyArtistId): string {
  return `https://open.spotify.com/artist/${encodeURIComponent(id)}`;
}

/** The first official page any source gave for the event; that's where "Buy tickets" goes. */
export function ticketUrl(sources: readonly { url: string | null }[]): string | null {
  return sources.find((s) => s.url)?.url ?? null;
}

/**
 * UX #5 / OD-5: sites that actually sell tickets, plus official organiser and festival sites
 * (from the allow-list). Anything else (news, articles) is "Info", never "Buy tickets".
 */
const TICKET_DOMAINS = [
  "district.in",
  "insider.in",
  "bookmyshow.com",
  "skillboxes.com",
  "ticketmaster.com",
  "ticketmaster.co.in",
  "ticketmaster.in",
  "highape.com",
  "sortmyscene.com",
  ...ALLOWED_DOMAINS.filter((d) => d.trust === "official").map((d) => d.domain),
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const on = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

/** Live Nation sells on ticket paths only; its news site is not a ticket seller. */
function sellsTickets(url: string): boolean {
  const host = hostOf(url);
  if (on(host, "livenation.in") || on(host, "livenation.com")) {
    return !host.startsWith("news.") && /\/(tickets?|event)\b/i.test(new URL(url).pathname);
  }
  return TICKET_DOMAINS.some((d) => on(host, d));
}

export type TicketLink = { url: string; kind: "tickets" | "info"; label: string };

/** The honest outbound link: a ticket seller if any source has one, else an "Info ↗" page. */
export function ticketLink(urls: readonly (string | null | undefined)[]): TicketLink | null {
  const all = urls.filter((u): u is string => Boolean(u));
  const seller = all.find(sellsTickets);
  if (seller) return { url: seller, kind: "tickets", label: "🎟️ Tickets" };
  return all[0] ? { url: all[0], kind: "info", label: "ℹ️ Info ↗" } : null;
}

/**
 * "Back from Spotify" share nudge. Analytics (23 Nov): 69 people played a playlist but only 4
 * ever shared, and 7% came back. The moment someone returns from Spotify is the happiest moment
 * in the app, so that's when we ask them to send the gig to their friends. Once per show, at most
 * once per visit, never on top of another sheet.
 */
export const PLAYED_EVENT = "tixtape:played";
export const SHARE_SEEN_KEY = "tixtape.aftershare.v1";
/** Away at least this long: a real listen, not a stray tap that never left the page. */
export const MIN_AWAY_MS = 4_000;
const MAX_SEEN = 50;

export type Played = { eventId: string; vibe: string | null };

export function notePlayed(eventId: string | null | undefined, vibe: string | null = null): void {
  if (!eventId) return;
  try {
    window.dispatchEvent(new CustomEvent<Played>(PLAYED_EVENT, { detail: { eventId, vibe } }));
  } catch {
    // Outside a browser: nothing to show.
  }
}

export function parseSeen(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function withSeen(seen: string[], eventId: string): string[] {
  return [...seen.filter((id) => id !== eventId), eventId].slice(-MAX_SEEN);
}

export function shouldOfferShare(opts: {
  seen: string[];
  eventId: string;
  shownThisVisit: boolean;
  awayMs: number;
  otherSheetOpen: boolean;
}): boolean {
  return (
    !opts.shownThisVisit &&
    !opts.otherSheetOpen &&
    opts.awayMs >= MIN_AWAY_MS &&
    !opts.seen.includes(opts.eventId)
  );
}

/** The show's page, tagged so an arrival from the share counts as WhatsApp (D-090 `via`). */
export function sharePageUrl(origin: string, eventId: string, via: string): string {
  return `${origin}/events/${eventId}?via=${via}`;
}

export function whatsAppUrl(text: string, pageUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${pageUrl}`)}`;
}

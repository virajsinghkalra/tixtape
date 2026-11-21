/** Shared playlist name and description (D-040). Pure; dates are formatted in UTC. */

export const MAX_PLAYLIST_NAME = 100;
export const MAX_PLAYLIST_DESCRIPTION = 300;

const NAME_SUFFIX = " · Tixtape";
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Shortens to at most `max` UTF-16 units with "…", never cutting a surrogate pair (emoji) in half. */
const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
};

/** `{Event title} · Tixtape`, with the title shortened so the whole name fits 100 chars. */
export function playlistName(eventTitle: string): string {
  return clip(eventTitle.trim(), MAX_PLAYLIST_NAME - NAME_SUFFIX.length) + NAME_SUFFIX;
}

/**
 * "Songs from the {title} lineup. Updated {d MMM}. Popularity data: Last.fm. Live setlists:
 * setlist.fm. Made with Tixtape." Both data sources require credit where their data is used.
 */
export function playlistDescription(eventTitle: string, updatedAt: Date): string {
  const date = `${updatedAt.getUTCDate()} ${MONTHS[updatedAt.getUTCMonth()]}`;
  const tail = ` lineup. Updated ${date}. Popularity data: Last.fm. Live setlists: setlist.fm. Made with Tixtape.`;
  const head = "Songs from the ";
  return (
    head + clip(eventTitle.trim(), MAX_PLAYLIST_DESCRIPTION - head.length - tail.length) + tail
  );
}

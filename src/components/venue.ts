/**
 * Sources sometimes give a city but no venue yet, stored as a placeholder venue ("Venue TBA").
 * The UI never prints the placeholder: lists show just the city, an upcoming show's page says
 * the venue is coming, and a past show never says "TBA" (user feedback, 24 Nov).
 */
const PLACEHOLDER = /^(venue\s*)?(tba|tbd|to be announced|to be confirmed|tbc)$/iu;

export function isPlaceholderVenue(name: string | null | undefined): boolean {
  return !name || PLACEHOLDER.test(name.trim());
}

/** The venue's real name, or null while it isn't known. */
export function venueName(name: string | null | undefined): string | null {
  return isPlaceholderVenue(name) ? null : name!.trim();
}

/** Copy for an upcoming show whose venue isn't out yet. */
export const VENUE_SOON = "Venue drops soon 👀";

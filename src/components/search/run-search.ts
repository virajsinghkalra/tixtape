/**
 * Lets any chip on the page fill the search box and run the search (and, if nothing matches,
 * the live lookup). The page has one search box; it listens for this event.
 */
export const RUN_SEARCH_EVENT = "event-search:run";

export function runSearch(query: string): void {
  window.dispatchEvent(new CustomEvent<string>(RUN_SEARCH_EVENT, { detail: query }));
}

/** Well-known Indian festival and artist names: always-useful starting points. */
export const POPULAR_SEARCHES = [
  "Lollapalooza India",
  "Sunburn",
  "NH7 Weekender",
  "Diljit Dosanjh",
  "Prateek Kuhad",
  "Ritviz",
];

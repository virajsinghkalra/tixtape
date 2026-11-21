/**
 * Zero-query recommendations (D-047 §1): assemble sections from ranked lists, at most
 * `SECTION_SIZE` items each, and never the same event twice across sections.
 */
export const SECTION_SIZE = 5;

export type SectionId =
  "trending" | "this_weekend" | "near_you" | "for_you" | "up_next" | "popular_searches";

export type Section<E> =
  | { id: Exclude<SectionId, "popular_searches">; title: string; items: E[] }
  | { id: "popular_searches"; title: string; queries: string[] };

export type SectionInputs<E> = {
  trending: E[];
  thisWeekend: E[];
  /** With the city it's for; omitted when no city is known. */
  nearYou?: { city: string; items: E[] };
  /** Omitted until the user's top/followed artists are available (D-030). */
  forYou?: E[];
  /** Soonest upcoming events: keeps the panel useful before there is any engagement data. */
  upNext?: E[];
  popularSearches: string[];
};

/** D-047 order; an event goes to the first section that lists it. Empty sections are dropped. */
export function buildSections<E extends { id: string }>(input: SectionInputs<E>): Section<E>[] {
  const used = new Set<string>();
  const take = (items: E[]) => {
    const picked: E[] = [];
    for (const item of items) {
      if (picked.length === SECTION_SIZE) break;
      if (used.has(item.id)) continue;
      used.add(item.id);
      picked.push(item);
    }
    return picked;
  };
  const sections: Section<E>[] = [];
  const add = (
    id: Exclude<SectionId, "popular_searches">,
    title: string,
    items: E[] | undefined,
  ) => {
    const picked = items ? take(items) : [];
    if (picked.length > 0) sections.push({ id, title, items: picked });
  };
  add("trending", "Trending now", input.trending);
  add("this_weekend", "This weekend", input.thisWeekend);
  if (input.nearYou) add("near_you", `Near you · ${input.nearYou.city}`, input.nearYou.items);
  add("for_you", "For you", input.forYou);
  add("up_next", "Coming up", input.upNext);
  const queries = [...new Set(input.popularSearches)].slice(0, SECTION_SIZE);
  if (queries.length > 0)
    sections.push({ id: "popular_searches", title: "Popular searches", queries });
  return sections;
}

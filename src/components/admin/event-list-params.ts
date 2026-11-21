/**
 * Query parameters of the admin events list. Anything unexpected falls back to the default
 * instead of failing: a hand-edited URL should still show the list.
 */
import { EVENT_VISIBILITIES, type EventVisibility } from "@/domain/events/visibility";

export type EventListParams = {
  visibility: EventVisibility | null;
  q: string | null;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function readEventListParams(raw: Raw): EventListParams {
  const v = first(raw.visibility);
  const q = first(raw.q)?.trim().slice(0, 100);
  const page = Number(first(raw.page));
  return {
    visibility: EVENT_VISIBILITIES.find((x) => x === v) ?? null,
    q: q ? q : null,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function listHref(p: EventListParams): string {
  const search = new URLSearchParams();
  if (p.visibility) search.set("visibility", p.visibility);
  if (p.q) search.set("q", p.q);
  if (p.page > 1) search.set("page", String(p.page));
  const s = search.toString();
  return s ? `/admin/events?${s}` : "/admin/events";
}

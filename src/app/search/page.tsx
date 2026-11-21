import type { Metadata } from "next";
import Link from "next/link";
import { ListEventsQuerySchema, SearchPageParamsSchema } from "@/application/events";
import type { EventDetail } from "@/application/ports/events";
import { EmptyState } from "@/components/EmptyState";
import { EventCard } from "@/components/EventCard";
import { groupByTier } from "@/components/lineup-view";
import { ticketLink } from "@/components/links";
import { EventSearch } from "@/components/search/EventSearch";
import { ZeroResults } from "@/components/search/ZeroResults";
import { weekendRange } from "@/components/search/local-sections";
import { cityHref, reasonLabel, upcomingLabel } from "@/components/search/search-view";
import type { MatchReason } from "@/components/search/types";
import { ChipLink } from "@/components/ui/ChipLink";
import { buttonClass } from "@/components/ui/Button";
import type { ShowRowItem } from "@/components/ShowRow";
import { COPY, inCity } from "@/components/ux-copy";
import { events } from "@/server/events";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { cookies, headers } from "next/headers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

const PAGE_SIZE = 12;

type Params = {
  q?: string;
  city?: string;
  artist?: string;
  from?: string;
  to?: string;
  type?: string;
  page?: string;
};

type Row = {
  id: string;
  matchReason: MatchReason;
  matchedText: string;
  matchedArtist?: string;
  city: string | null;
  venueName: string | null;
};

type PageData = {
  rows: Row[];
  artists: { name: string; upcomingCount: number }[];
  cities: { city: string; upcomingCount: number }[];
  fallback: Row[];
  didYouMean?: string;
  total: number;
};

/**
 * D-048: the full results page (Enter with nothing highlighted, an artist with 2+ shows, a city).
 * Uses the search engine in-process; if it fails, falls back to the plain event list so the page
 * still answers.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const now = new Date();
  const data = await load(params, page, now);
  // UX #7: a text or artist search with nothing found becomes discovery, not a dead end.
  const lookedFor = data.rows.length === 0 ? (params.artist ?? params.q)?.trim() : undefined;
  const near = lookedFor ? await nearYou(now) : null;
  const details = await detailsFor(
    [...data.rows, ...(lookedFor ? [] : data.fallback)].map((r) => r.id),
  );
  const heading = params.artist
    ? `Shows by ${params.artist}`
    : params.city && !params.q
      ? `Shows in ${params.city}`
      : params.q
        ? `Results for “${params.q}”`
        : "All upcoming shows";

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
      <div className="relative z-20 max-w-2xl">
        <EventSearch initialQuery={params.q ?? ""} restoreResults={false} />
      </div>
      <h1 className="mt-10 font-display text-huge font-extrabold">{heading}</h1>
      {!lookedFor && (
        <p className="mt-2 text-muted">
          {data.total} {data.total === 1 ? "show" : "shows"}
        </p>
      )}

      <nav aria-label="Dates" className="mt-5 flex flex-wrap gap-2">
        {dateChips(params, now).map((c) => (
          <ChipLink key={c.label} href={c.href} selected={c.selected}>
            {c.label}
          </ChipLink>
        ))}
      </nav>

      {(data.artists.length > 0 || data.cities.length > 0) && (
        <div className="mt-6 flex flex-wrap gap-2">
          {data.artists.map((a) => (
            <ChipLink key={a.name} href={`/search?artist=${encodeURIComponent(a.name)}`}>
              <span aria-hidden>🎤</span> {a.name} · {upcomingLabel(a.upcomingCount)}
            </ChipLink>
          ))}
          {data.cities.map((c) => (
            <ChipLink key={c.city} href={cityHref(c.city)}>
              <span aria-hidden>📍</span> {c.city} · {upcomingLabel(c.upcomingCount)}
            </ChipLink>
          ))}
        </div>
      )}

      {lookedFor ? (
        <div className="mt-8">
          {/* The live lookup and similar artists run after paint (D-057). */}
          <ZeroResults
            query={lookedFor}
            nearTitle={near?.title ?? COPY.upNext}
            nearRow={near?.items ?? []}
            didYouMean={data.didYouMean}
          />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="mt-8 space-y-8">
          <EmptyState
            emoji="🔍"
            title={`No ${params.artist ?? params.q ?? params.city ?? ""} shows yet`}
          >
            {data.didYouMean ? (
              <>
                Did you mean{" "}
                <Link
                  className="font-semibold underline"
                  href={`/search?q=${encodeURIComponent(data.didYouMean)}`}
                >
                  {data.didYouMean}
                </Link>
                ?
              </>
            ) : (
              "Try an artist or city"
            )}
          </EmptyState>
          {data.fallback.length > 0 && (
            <ResultGrid
              title="Try these instead"
              rows={data.fallback}
              details={details}
              now={now}
            />
          )}
        </div>
      ) : (
        <ResultGrid rows={data.rows} details={details} now={now} />
      )}

      <Pager params={params} page={page} total={data.total} />
    </div>
  );
}

/** UX #7 "In your city": the visitor's city, soonest first; All India's soonest without one. */
async function nearYou(now: Date): Promise<{ title: string; items: ShowRowItem[] }> {
  const city =
    visitorCity({ headers: await headers(), cookie: (await cookies()).get(CITY_COOKIE)?.value })
      ?.city ?? null;
  try {
    const r = await events().searchPage(
      SearchPageParamsSchema.parse({
        from: now.toISOString(),
        ...(city ? { city } : {}),
        pageSize: "6",
      }),
    );
    return {
      title: city ? inCity(city) : COPY.upNext,
      items: r.results.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        city: e.city,
      })),
    };
  } catch (err) {
    console.error("Search page: near-you row unavailable", err);
    return { title: COPY.upNext, items: [] };
  }
}

function ResultGrid(props: {
  title?: string;
  rows: Row[];
  details: Map<string, EventDetail>;
  now: Date;
}) {
  return (
    <section aria-label={props.title ?? "Results"} className="mt-8">
      {props.title ? (
        <h2 className="mb-4 font-display text-big font-extrabold">{props.title}</h2>
      ) : (
        <h2 className="sr-only">Results</h2>
      )}
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {props.rows.map((r, i) => {
          const d = props.details.get(r.id);
          if (!d) return null;
          return (
            <li key={r.id}>
              <EventCard
                event={d}
                now={props.now}
                index={i}
                headliners={groupByTier(d.lineup)[0]?.artists.map((a) => a.name) ?? []}
                artists={d.lineup}
                ticketUrl={ticketLink(d.sources.map((x) => x.url))?.url}
                note={reasonLabel({
                  ...r,
                  title: d.title,
                  type: d.type,
                  startsAt: "",
                  startsAtDateOnly: false,
                })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Pager({ params, page, total }: { params: Params; page: number; total: number }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const href = (p: number) =>
    `/search?${new URLSearchParams({ ...clean(params), page: String(p) })}`;
  return (
    <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-3">
      {page > 1 && (
        <Link href={href(page - 1)} className={buttonClass("secondary")}>
          ← Newer
        </Link>
      )}
      <span className="text-sm font-semibold">
        Page {page}/{pages}
      </span>
      {page < pages && (
        <Link href={href(page + 1)} className={buttonClass("secondary")}>
          More →
        </Link>
      )}
    </nav>
  );
}

async function load(params: Params, page: number, now: Date): Promise<PageData> {
  const from = params.from ?? now.toISOString();
  try {
    const parsed = SearchPageParamsSchema.safeParse({
      ...clean(params),
      from,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (!parsed.success) return { rows: [], artists: [], cities: [], fallback: [], total: 0 };
    const r = await events().searchPage(parsed.data);
    return {
      rows: r.results,
      artists: r.artists,
      cities: r.cities,
      fallback: (r.fallback ?? []).map((e) => ({ ...e, matchReason: "title", matchedText: "" })),
      didYouMean: r.didYouMean,
      total: r.total,
    };
  } catch (err) {
    console.error("Search page engine failed; falling back to the event list", err);
    const list = await events().listEvents(
      ListEventsQuerySchema.parse({
        q: params.q?.slice(0, 100) || params.artist?.slice(0, 100) || undefined,
        city: params.city,
        from,
        to: params.to,
        type: params.type === "festival" || params.type === "concert" ? params.type : undefined,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      }),
    );
    return {
      rows: list.items.map((e) => ({
        id: e.id,
        matchReason: "title",
        matchedText: "",
        city: e.venue?.city ?? null,
        venueName: e.venue?.name ?? null,
      })),
      artists: [],
      cities: [],
      fallback: [],
      total: list.total,
    };
  }
}

async function detailsFor(ids: string[]): Promise<Map<string, EventDetail>> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(
    unique.map((id) =>
      events()
        .getEvent(id as EventDetail["id"])
        .catch(() => null),
    ),
  );
  return new Map(found.filter((d): d is EventDetail => d !== null).map((d) => [d.id, d]));
}

/** Date chips keep every other filter: All dates, This weekend, This month. */
function dateChips(params: Params, now: Date) {
  const base = clean({ ...params, from: undefined, to: undefined, page: undefined });
  const weekend = weekendRange(now);
  const istNow = new Date(now.getTime() + 5.5 * 3_600_000);
  const monthEnd = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() + 1, 1) - 5.5 * 3_600_000 - 1,
  );
  const href = (from?: Date, to?: Date) =>
    `/search?${new URLSearchParams({ ...base, ...(from ? { from: from.toISOString() } : {}), ...(to ? { to: to.toISOString() } : {}) })}`;
  const selected = (to?: Date) => (to ? params.to === to.toISOString() : !params.to);
  return [
    { label: "All dates", href: href(), selected: selected() },
    {
      label: "📅 This weekend",
      href: href(weekend.from, weekend.to),
      selected: selected(weekend.to),
    },
    { label: "🗓️ This month", href: href(now, monthEnd), selected: selected(monthEnd) },
  ].map((c) => ({ ...c, href: c.href.replace(/\?$/, "") }));
}

function clean(p: Params): Record<string, string> {
  return Object.fromEntries(
    Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
}

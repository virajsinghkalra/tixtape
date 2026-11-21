import Link from "next/link";
import { ListEventsQuerySchema, SuggestParamsSchema } from "@/application/events";
import type { EventDetail, EventSummary } from "@/application/ports/events";
import { AuthNotice } from "@/components/AuthNotice";
import { CitySwitcher } from "@/components/CitySwitcher";
import { EventCard } from "@/components/EventCard";
import { toneSequence } from "@/components/event-color";
import { countdownBadge, formatDateRange, istParts } from "@/components/event-format";
import { HowItWorks } from "@/components/HowItWorks";
import { TrySearchingTile } from "@/components/TrySearchingTile";
import { groupByTier } from "@/components/lineup-view";
import { ticketUrl } from "@/components/links";
import { EventSearch } from "@/components/search/EventSearch";
import { localSections, toEventResult } from "@/components/search/local-sections";
import { POPULAR_SEARCHES } from "@/components/search/run-search";
import type { RecommendationSection } from "@/components/search/types";
import { SearchLauncher } from "@/components/SearchLauncher";
import { Section } from "@/components/Section";
import { planStory } from "@/components/story-plan";
import { UpNextRings, type RingEvent } from "@/components/UpNextRings";
import { BottomBar } from "@/components/ui/BottomBar";
import { Marquee } from "@/components/ui/Marquee";
import { Sticker } from "@/components/ui/Sticker";
import { Tile } from "@/components/ui/Tile";
import { cookies, headers } from "next/headers";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { events } from "@/server/events";

export const dynamic = "force-dynamic";

const UPCOMING_LIMIT = 12;
const JUST_ANNOUNCED_LIMIT = 6;
const WEEK_MS = 7 * 86_400_000;
/** Up to this many events, Just announced would repeat Upcoming; How it works shows instead. */
const SMALL_CATALOGUE = 4;

/**
 * "Popular searches" (D-047) from the suggest engine's empty-query sections, in-process. Falls
 * back to well-known names while search logs are empty or the engine isn't available.
 */
async function popularSearches(): Promise<string[]> {
  try {
    const res = await events().suggest(SuggestParamsSchema.parse({}));
    const fromLogs =
      "sections" in res
        ? res.sections.find((x) => x.id === "popular_searches")?.queries
        : undefined;
    return fromLogs && fromLogs.length >= 3 ? fromLogs.slice(0, 6) : POPULAR_SEARCHES;
  } catch (err) {
    console.error("Popular searches unavailable; using defaults", err);
    return POPULAR_SEARCHES;
  }
}

type Props = { searchParams: Promise<{ auth_error?: string; q?: string }> };

export default async function Home({ searchParams }: Props) {
  const { auth_error: authError, q } = await searchParams;
  const now = new Date();
  const page = await events().listEvents(
    ListEventsQuerySchema.parse({ from: now.toISOString(), pageSize: String(UPCOMING_LIMIT) }),
  );
  const upcoming = page.items;
  // Summaries carry neither ticket URLs, headliners nor "first seen", so read this bounded page's
  // details. A suggest/feed endpoint with these fields would remove it (see hand-back).
  const details = await Promise.all(upcoming.map((e) => events().getEvent(e.id)));
  const byId = new Map<string, EventDetail>(details.map((d) => [d.id, d]));
  const soloImageOf = (id: string) => {
    const lineup = byId.get(id)?.lineup ?? [];
    return lineup.length === 1 ? lineup[0]!.imageUrl : null;
  };
  const headlinersOf = (id: string) =>
    groupByTier(byId.get(id)?.lineup ?? [])[0]?.artists.map((a) => a.name) ?? [];
  const justAnnounced = [...details]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, JUST_ANNOUNCED_LIMIT);
  const thisWeek = upcoming.filter((e) => e.startsAt.getTime() - now.getTime() < WEEK_MS);
  const next = upcoming[0];
  const cities = new Set(upcoming.flatMap((e) => (e.venue ? [e.venue.city] : [])));
  const jar = await cookies();
  // D-050: chosen city (cookie) or IP city in production; null locally → "All India".
  const city =
    visitorCity({ headers: await headers(), cookie: jar.get(CITY_COOKIE)?.value })?.city ?? null;
  const inCity = city
    ? (
        await events().listEvents(
          ListEventsQuerySchema.parse({
            city,
            from: now.toISOString(),
            pageSize: String(UPCOMING_LIMIT),
          }),
        )
      ).items
    : [];
  const feed = city && inCity.length > 0 ? inCity : upcoming;
  const popular = await popularSearches();
  const empty = upcoming.length === 0;
  const nearIds = new Set(inCity.map((e) => e.id));
  const popularSection: RecommendationSection = {
    id: "popular_searches",
    title: "Popular searches",
    queries: popular,
  };
  const sections: RecommendationSection[] = empty
    ? [popularSection]
    : [
        ...(inCity.length > 0
          ? [
              {
                id: "near_you" as const,
                title: `Near you · ${city}`,
                items: inCity.slice(0, 5).map(toEventResult),
              },
            ]
          : []),
        ...localSections(
          upcoming.filter((e) => !nearIds.has(e.id)),
          now,
        ),
        popularSection,
      ];
  const marquee = [...new Set(details.flatMap((d) => headlinersOf(d.id)))];

  return (
    <>
      {authError && <AuthNotice code={authError} />}

      <section
        aria-labelledby="hero-title"
        className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Tile tone="lime" className="pop-in z-20 overflow-visible lg:col-span-2 lg:row-span-2">
            <div className="flex flex-wrap items-center gap-3">
              <Sticker tone="night" emoji="🇮🇳" tilt={-4}>
                Gigs &amp; festivals across India
              </Sticker>
              <CitySwitcher city={city} cities={[...cities]} />
            </div>
            <h1
              id="hero-title"
              className="mt-5 font-display text-mega font-extrabold tracking-tight text-balance"
            >
              Every lineup. One playlist.
            </h1>
            <p className="mt-4 max-w-xl text-lg font-medium">
              Find a concert or festival and press play on the whole lineup: one shared Spotify
              playlist, headliners first. No login needed.
            </p>
            <div className="mt-7 max-w-2xl">
              <EventSearch initialQuery={q ?? ""} sections={sections} city={city} />
            </div>
          </Tile>

          {next ? (
            <>
              <NextUpTile event={next} now={now} />
              <Tile tone="sky" className="pop-in [--i:2]">
                <p className="text-sm font-bold">On the board</p>
                <p className="mt-2 flex items-baseline gap-3 font-display font-extrabold">
                  <span className="text-huge">{page.total}</span>
                  <span className="text-xl">{page.total === 1 ? "gig" : "gigs"}</span>
                </p>
                <p className="flex items-baseline gap-3 font-display font-extrabold">
                  <span className="text-huge">{cities.size}</span>
                  <span className="text-xl">{cities.size === 1 ? "city" : "cities"}</span>
                </p>
              </Tile>
            </>
          ) : (
            <div className="lg:row-span-2 lg:flex">
              <TrySearchingTile queries={popular} />
            </div>
          )}
        </div>
      </section>

      {thisWeek.length > 0 && (
        <Section
          id="rings"
          emoji="📍"
          title="Happening this week"
          blurb="Tap a ring for the 10-second story."
        >
          <UpNextRings
            events={thisWeek.slice(0, 10).map((e) => ringEvent(e, byId.get(e.id), now))}
          />
        </Section>
      )}

      {!empty && (
        <Section
          id="upcoming"
          emoji="🗓️"
          title={city && inCity.length > 0 ? `Upcoming in ${city}` : "Upcoming"}
          blurb={
            city && inCity.length === 0
              ? `No gigs in ${city} yet. Here's what's on across India.`
              : "Soonest first."
          }
        >
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {feed.map((e, i) => (
              <li key={e.id}>
                <EventCard
                  event={e}
                  now={now}
                  index={i}
                  headliners={headlinersOf(e.id)}
                  image={soloImageOf(e.id)}
                  ticketUrl={ticketUrl(byId.get(e.id)?.sources ?? [])}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {marquee.length > 0 && (
        <Marquee label="Artists coming up" items={marquee} tone="violet" className="mt-12" />
      )}

      {/* Only when it adds something: with a handful of events it would repeat Upcoming. */}
      {upcoming.length > SMALL_CATALOGUE && (
        <Section id="just-announced" emoji="🆕" title="Just announced" blurb="Fresh on the board.">
          <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-1 pb-3 [contain:paint] sm:-mx-6 sm:px-6">
            {justAnnounced.map((e, i) => (
              <li key={e.id} className="w-[78%] shrink-0 snap-start sm:w-[20rem]">
                <EventCard
                  event={e}
                  now={now}
                  index={i}
                  variant="compact"
                  headliners={headlinersOf(e.id)}
                  image={soloImageOf(e.id)}
                  ticketUrl={ticketUrl(e.sources)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {upcoming.length <= SMALL_CATALOGUE && <HowItWorks />}

      <BottomBar label="Quick actions">
        <SearchLauncher />
      </BottomBar>
    </>
  );
}

function NextUpTile({ event, now }: { event: EventSummary; now: Date }) {
  const badge = countdownBadge(event.startsAt, event.endsAt, now);
  return (
    <Tile tone="violet" className="pop-in flex flex-col justify-between gap-6 [--i:1]">
      <p className="text-sm font-bold">
        <span aria-hidden>{badge.emoji} </span>Next up
      </p>
      <Link
        href={`/events/${event.id}`}
        className="group block rounded-field outline-offset-4 focus-visible:outline-white"
      >
        <span className="block font-display text-big font-extrabold">{badge.label}</span>
        <span className="mt-1 block text-lg font-semibold underline-offset-4 group-hover:underline">
          {event.title} <span aria-hidden>→</span>
        </span>
      </Link>
    </Tile>
  );
}

function ringEvent(e: EventSummary, detail: EventDetail | undefined, now: Date): RingEvent {
  const { day, month } = istParts(e.startsAt);
  return {
    id: e.id,
    title: e.title,
    day,
    month,
    tone: toneSequence(e.id, 1)[0]!,
    story: planStory({
      id: e.id,
      title: e.title,
      dateLine: formatDateRange(e.startsAt, e.endsAt),
      city: e.venue?.city ?? null,
      badge: countdownBadge(e.startsAt, e.endsAt, now),
      artists: (detail?.lineup ?? []).map((a) => ({
        name: a.name,
        imageUrl: a.imageUrl,
        tier: a.tier,
        billingRank: a.billingRank,
      })),
      preview: null,
      playlistHref: `/events/${e.id}#playlist`,
      eventHref: `/events/${e.id}`,
    }),
  };
}

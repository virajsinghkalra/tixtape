import Link from "next/link";
import { SuggestParamsSchema } from "@/application/events";
import type { FeedRow } from "@/application/ports/event-feed";
import type { Tour } from "@/domain/events/front-page";
import type { EventSummary } from "@/application/ports/events";
import { AuthNotice } from "@/components/AuthNotice";
import { CitySwitcher } from "@/components/CitySwitcher";
import { toneSequence } from "@/components/event-color";
import { countdownBadge, formatDateRange, istDayCount, istParts } from "@/components/event-format";
import { FrontSection, tourInfo } from "@/components/FrontSection";
import { HowItWorks } from "@/components/HowItWorks";
import { TrySearchingTile } from "@/components/TrySearchingTile";
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
import { noteVisitorDemand } from "@/server/demand";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { events } from "@/server/events";
import { frontPage } from "@/server/front-page";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;
/** Up to this many events, "How it works" helps more than more sections would. */
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
  const jar = await cookies();
  // D-050: chosen city (cookie) or IP city in production; null locally → "All India".
  const city =
    visitorCity({ headers: await headers(), cookie: jar.get(CITY_COOKIE)?.value })?.city ?? null;
  // D-081: a per-city, per-day count of where people look (no personal data), after the response.
  await noteVisitorDemand("view");
  // D-079: one feed read, ranked by size × proximity × timing (pure, in the domain).
  const [{ rows, page: front }, popular] = await Promise.all([
    frontPage({ now, city }),
    popularSearches(),
  ]);
  const empty = rows.length === 0;
  const next = rows[0];
  const cities = new Set(rows.flatMap((e) => (e.city ? [e.city] : [])));
  const thisWeek = rows.filter((e) => e.startsAt.getTime() - now.getTime() < WEEK_MS);
  const nearRows = front.nearYou.map((i) => (i.kind === "event" ? i.event : i.tour.featured));
  const nearIds = new Set(nearRows.map((e) => e.id));
  const popularSection: RecommendationSection = {
    id: "popular_searches",
    title: "Popular searches",
    queries: popular,
  };
  const sections: RecommendationSection[] = empty
    ? [popularSection]
    : [
        ...(nearRows.length > 0
          ? [
              {
                id: "near_you" as const,
                title: `Near you · ${city}`,
                items: nearRows.slice(0, 5).map(toEventResult),
              },
            ]
          : []),
        ...localSections(
          rows.filter((e) => !nearIds.has(e.id)),
          now,
        ),
        popularSection,
      ];
  const marquee = [...new Set(rows.flatMap((r) => r.headliners.slice(0, 1)))].slice(0, 16);
  const today = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now.getTime() + WEEK_MS).toISOString().slice(0, 10);

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
                  <span className="text-huge">{rows.length}</span>
                  <span className="text-xl">{rows.length === 1 ? "gig" : "gigs"}</span>
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

      {/* The story strip may repeat cards from the sections below. */}
      {thisWeek.length > 0 && (
        <Section
          id="rings"
          emoji="📍"
          title="Happening this week"
          blurb="Tap a ring for the 10-second story."
        >
          <UpNextRings events={thisWeek.slice(0, 10).map((e) => ringEvent(e, now))} />
        </Section>
      )}

      {city && (
        <FrontSection
          id="near-you"
          emoji="📍"
          title={`Near you · ${city}`}
          items={front.nearYou}
          now={now}
          city={city}
          seeAll={`/search?city=${encodeURIComponent(city)}`}
        />
      )}

      <FrontSection
        id="big-ones"
        emoji="🔥"
        title="The big ones"
        blurb={
          city && front.nearYou.length === 0 && !empty
            ? `No gigs in ${city} yet. Here's what's on across India.`
            : "The biggest shows across India."
        }
        items={front.bigOnes}
        now={now}
        city={city}
        seeAll={`/search?from=${today}`}
      />

      {marquee.length > 0 && (
        <Marquee label="Artists coming up" items={marquee} tone="violet" className="mt-12" />
      )}

      <FrontSection
        id="this-week"
        emoji="⚡"
        title="This week"
        items={front.thisWeek}
        now={now}
        city={city}
        seeAll={`/search?from=${today}&to=${weekEnd}`}
      />

      <FrontSection
        id="just-announced"
        emoji="🆕"
        title="Just announced"
        blurb="Fresh on the board."
        items={front.justAnnounced}
        now={now}
        city={city}
        layout="row"
        seeAll={`/search?from=${today}`}
      />

      {front.tours.length > 0 && <ToursList tours={front.tours} />}

      {rows.length <= SMALL_CATALOGUE && <HowItWorks />}

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

function ringEvent(e: FeedRow, now: Date): RingEvent {
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
      city: e.city,
      badge: countdownBadge(e.startsAt, e.endsAt, now),
      // The feed carries the top-billed names (and a solo photo), enough for the story.
      artists: e.headliners.map((name, i) => ({
        name,
        imageUrl: e.artistCount === 1 ? e.soloImage : null,
        tier: "headliner" as const,
        billingRank: i + 1,
      })),
      preview: null,
      playlistHref: `/events/${e.id}#playlist`,
      eventHref: `/events/${e.id}`,
      days: istDayCount(e.startsAt, e.endsAt),
    }),
  };
}

/** Tours, collapsed: one line each, opening to every city (D-079). */
function ToursList({ tours }: { tours: Tour<FeedRow>[] }) {
  return (
    <section aria-labelledby="tours-title" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
      <h2 id="tours-title" className="mb-4 font-display text-big font-extrabold tracking-tight">
        <span aria-hidden className="mr-2">
          🗺️
        </span>
        Tours
      </h2>
      <ul className="space-y-3">
        {tours.map((t) => {
          const info = tourInfo(t, null);
          return (
            <li key={t.key}>
              <details className="group/t rounded-card border-2 border-night bg-surface dark:border-line">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2">
                  <span className="font-display text-lg font-bold">{t.title}</span>
                  <span className="shrink-0 text-sm font-semibold text-accent-text">
                    {info.count}{" "}
                    <span
                      aria-hidden
                      className="inline-block transition-transform group-open/t:rotate-180"
                    >
                      ▾
                    </span>
                  </span>
                </summary>
                <ul className="grid gap-1 px-2 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                  {info.stops.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/events/${s.id}`}
                        className="flex min-h-11 items-center justify-between rounded-field px-3 hover:bg-surface-2"
                      >
                        {s.label} <span aria-hidden>→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

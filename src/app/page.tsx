import { SuggestParamsSchema } from "@/application/events";
import type { FeedRow } from "@/application/ports/event-feed";
import { metroOf, type FrontItem } from "@/domain/events/front-page";
import { AuthNotice } from "@/components/AuthNotice";
import { CityEmptyNote } from "@/components/CitySwitcher";
import { toneSequence } from "@/components/event-color";
import {
  countdownBadge,
  formatDateRange,
  hasEnded,
  istParts,
  yearTag,
  shortDate,
} from "@/components/event-format";
import { FrontSection } from "@/components/FrontSection";
import { artistVisual, orderForVisuals } from "@/domain/visuals/visuals";
import { HeroBoard } from "@/components/HeroBoard";
import { readyFirst } from "@/components/nav/browse";
import { pickNextUp, shortTitle } from "@/components/hero-copy";
import { playlistBadge } from "@/components/lineup-copy";
import { SectionBoundary } from "@/components/ui/SectionBoundary";
import { HeroNextUp, type NextUpItem } from "@/components/HeroNextUp";
import { HowItWorks } from "@/components/HowItWorks";
import { TrySearchingTile } from "@/components/TrySearchingTile";
import { EventSearch } from "@/components/search/EventSearch";
import { localSections, toEventResult } from "@/components/search/local-sections";
import type { RecommendationSection } from "@/components/search/types";
import { SearchLauncher } from "@/components/SearchLauncher";
import { Section } from "@/components/Section";
import { planStory } from "@/components/story-plan";
import { vibeOf, type Vibe } from "@/components/vibe-copy";
import { UpNextRings, type RingEvent } from "@/components/UpNextRings";
import { BottomBar } from "@/components/ui/BottomBar";
import { Marquee } from "@/components/ui/Marquee";
import { Sticker } from "@/components/ui/Sticker";
import { Tile } from "@/components/ui/Tile";
import { cookies, headers } from "next/headers";
import { noteVisitorDemand } from "@/server/demand";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { events } from "@/server/events";
import { frontPage, recentSpotifyOpens } from "@/server/front-page";
import { pickHotList } from "@/domain/events/trending";
import { HotRail } from "@/components/TrendingCard";
import { VibePicker } from "@/components/VibePicker";
import { TourRail } from "@/components/TourRail";
import { YourGigs } from "@/components/YourGigs";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;
/** Up to this many events, "How it works" helps more than more sections would. */
const SMALL_CATALOGUE = 4;

/**
 * "Popular searches" (D-047) from the suggest engine's empty-query sections, in-process: real
 * searches that found something, then upcoming event titles, each checked to return results
 * (QA-F-6). No hardcoded names: a chip that finds nothing is never shown.
 */
async function popularSearches(): Promise<string[]> {
  try {
    const res = await events().suggest(SuggestParamsSchema.parse({}));
    const chips =
      "sections" in res
        ? res.sections.find((x) => x.id === "popular_searches")?.queries
        : undefined;
    return chips?.slice(0, 6) ?? [];
  } catch (err) {
    console.error("Popular searches unavailable", err);
    return [];
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
  const [{ rows, page: front }, popular, opens] = await Promise.all([
    frontPage({ now, city }),
    popularSearches(),
    recentSpotifyOpens(now),
  ]);
  const empty = rows.length === 0;
  const next = rows[0];
  // UX #6: the hero prefers ready playlists; OD-7: its shows aren't repeated below.
  const hero = pickNextUp(rows, now);
  const heroIds = new Set(hero.map((e) => e.id));
  // Funnel (24 Nov): most visitors left without opening a show, so the hero plays the
  // hottest playlists in their own city first (a swipeable rail), then the rest of India.
  const inCity = (e: FeedRow) => Boolean(city && e.city && metroOf(e.city) === metroOf(city));
  const hotList = pickHotList(rows, opens, inCity, 6);
  const hotKicker = hotList[0]?.local && city ? `Hot in ${city}` : "Trending now";
  const hotItems = hotList.map(({ item: e }) => {
    const title = shortTitle(e.title, e.headliners[0]);
    return {
      id: e.id,
      title,
      // No "Bengaluru" twice when the short title already names the city.
      when: [shortDate(e.startsAt, now), e.city && !title.includes(e.city) ? e.city : null]
        .filter(Boolean)
        .join(" · "),
      poster: e.posterUrl ?? null,
      artists: e.headlinerArtists,
      label: e.headliners[0] ?? e.title,
      playlistUrl: e.playlistUrl!,
      vibe: vibeOf(e.genre, e.type),
    };
  });
  // "Pick your vibe": genres with upcoming shows, most shows first.
  const vibeCounts = new Map<Vibe, number>();
  for (const e of rows) {
    const v = vibeOf(e.genre, e.type);
    if (v !== "default") vibeCounts.set(v, (vibeCounts.get(v) ?? 0) + 1);
  }
  const vibes = [...vibeCounts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const thisWeek = readyFirst(
    rows.filter(
      (e) =>
        e.startsAt.getTime() - now.getTime() < WEEK_MS &&
        !heroIds.has(e.id) &&
        !hasEnded(e.startsAt, e.endsAt, now),
    ),
  );
  // Playable shows lead each section; the far-off ones follow (stable within each group).
  const playable = (i: FrontItem<FeedRow>) => ({
    playlistUrl: (i.kind === "event" ? i.event : i.tour.featured).playlistUrl,
  });
  const readyLead = (items: FrontItem<FeedRow>[]) =>
    readyFirst(items.map((item) => ({ ...playable(item), item }))).map((x) => x.item);
  const nearYou = readyLead(
    front.nearYou.filter((i) => i.kind !== "event" || !heroIds.has(i.event.id)),
  );
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
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
          <Tile
            tone="lime"
            className="pop-in z-20 min-w-0 overflow-visible lg:col-span-2 lg:row-span-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Sticker tone="night" emoji="🎧" tilt={-4}>
                Concert playlists · India
              </Sticker>
            </div>
            <h1
              id="hero-title"
              className="mt-4 sm:mt-5 font-display text-mega font-extrabold tracking-tight text-balance"
            >
              Every gig. Its playlist.
            </h1>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full max-sm:hidden border-2 border-night bg-night px-4 py-2 text-base leading-none font-bold text-lime shadow-[3px_3px_0_0_var(--color-violet)] sm:text-lg">
              <span aria-hidden className="text-xl leading-none">
                🎧
              </span>
              tap a show, vibe to its setlist
            </p>
            <div className="mt-5 max-w-2xl sm:mt-7">
              <EventSearch initialQuery={q ?? ""} sections={sections} city={city} />
              <HotRail kicker={hotKicker} items={hotItems} />
            </div>
          </Tile>

          {next ? (
            <>
              <SectionBoundary label="Next up">
                <HeroNextUp items={hero.map(nextUpItem)} now={now.toISOString()} />
              </SectionBoundary>
              {/* UX #6: the stats tile costs a screen of scroll on phones; desktop only. */}
              <div className="hidden sm:contents">
                <HeroBoard gigs={rows.length} cities={citiesByCount(rows)} />
              </div>
            </>
          ) : (
            <div className="lg:row-span-2 lg:flex">
              <TrySearchingTile queries={popular} />
            </div>
          )}
        </div>
      </section>

      <VibePicker vibes={vibes} />

      <SectionBoundary label="Your gigs">
        <YourGigs />
      </SectionBoundary>

      {/* The story strip may repeat cards from the sections below. */}
      {/* UX #6 / OD-7: no repeats: shows in the hero are left out of the rings and Near you. */}
      {thisWeek.length > 0 && (
        <Section id="rings" emoji="📍" title="Happening this week" blurb="Tap to peek">
          <SectionBoundary label="Happening this week">
            <UpNextRings events={thisWeek.slice(0, 10).map((e) => ringEvent(e, now))} />
          </SectionBoundary>
        </Section>
      )}

      {city && nearYou.length === 0 && !empty && <CityEmptyNote city={city} />}

      {city && (
        <FrontSection
          id="near-you"
          emoji="📍"
          title={`Near you · ${city}`}
          items={nearYou}
          now={now}
          city={city}
          layout="row"
          seeAll={`/search?city=${encodeURIComponent(city)}`}
        />
      )}

      <FrontSection
        id="big-ones"
        emoji="🔥"
        title="The big ones"
        blurb={
          city && nearYou.length === 0 && !empty ? `Quiet in ${city} · All India` : "All India"
        }
        items={readyLead(front.bigOnes)}
        now={now}
        city={city}
        layout="row"
        seeAll={`/search?from=${today}`}
      />

      {marquee.length > 0 && (
        <Marquee label="Artists coming up" items={marquee} tone="violet" className="mt-12" />
      )}

      <FrontSection
        id="this-week"
        emoji="⚡"
        title="This week"
        items={readyLead(front.thisWeek)}
        now={now}
        city={city}
        layout="row"
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

      {front.tours.length > 0 && (
        <SectionBoundary label="Tours">
          <TourRail tours={front.tours} />
        </SectionBoundary>
      )}

      {rows.length <= SMALL_CATALOGUE && <HowItWorks />}

      <BottomBar label="Quick actions">
        <SearchLauncher />
      </BottomBar>
    </>
  );
}

/** D-082 hero: the next shows, picture first, with a short title (`shortTitle`). */
function nextUpItem(e: FeedRow): NextUpItem {
  return {
    id: e.id,
    title: shortTitle(e.title, e.headliners[0]),
    poster: e.posterUrl ?? null,
    artists: e.headlinerArtists,
    label: e.headliners[0] ?? e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    dateOnly: e.startsAtDateOnly ?? false,
    badge: playlistBadge(e.playlistStatus),
  };
}

/** The ring's picture: the first headliner photo (D-083 order), else the poster. */
function ringImage(e: FeedRow): string | null {
  const v = orderForVisuals(e.headlinerArtists)
    .map(artistVisual)
    .find((x) => x.kind === "photo");
  return v?.kind === "photo" ? v.url : (e.posterUrl ?? null);
}

/** Cities with the most shows first. */
function citiesByCount(rows: FeedRow[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) if (r.city) n.set(r.city, (n.get(r.city) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

function ringEvent(e: FeedRow, now: Date): RingEvent {
  const { day, month } = istParts(e.startsAt);
  return {
    id: e.id,
    title: e.title,
    label: e.headliners[0] ?? e.title.split(/\s[–—-]\s/u)[0]?.trim(),
    day,
    month: [month, yearTag(e.startsAt, now)].filter(Boolean).join(" "),
    tone: toneSequence(e.id, 1)[0]!,
    image: ringImage(e),
    live: e.playlistStatus === "ready",
    story: planStory({
      id: e.id,
      title: e.title,
      dateLine: formatDateRange(e.startsAt, e.endsAt),
      city: e.city,
      badge: countdownBadge(e.startsAt, e.endsAt, now),
      // The feed carries the top-billed names (and a solo photo), enough for the story.
      artists: e.headlinerArtists.map((a, i) => ({
        ...a,
        tier: "headliner" as const,
        billingRank: i + 1,
      })),
      poster: e.posterUrl,
      playlistHref: `/events/${e.id}#playlist`,
      eventHref: `/events/${e.id}`,
      playable: Boolean(e.playlistUrl) || e.playlistStatus === "building",
      vibe: vibeOf(e.genre, e.type),
    }),
  };
}

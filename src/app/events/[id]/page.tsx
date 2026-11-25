import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { parseEventId } from "@/application/events";
import type { EventDetail } from "@/application/ports/events";
import { EventActions } from "@/components/EventActions";
import { PlayCta } from "@/components/PlayCta";
import { readyUrl } from "@/components/playlist-state";
import { EventHeader } from "@/components/EventHeader";
import { formatDateRange, shortDate } from "@/components/event-format";
import { shortTitle } from "@/components/hero-copy";
import { HotRail } from "@/components/TrendingCard";
import { upcomingRows } from "@/server/front-page";
import { AlsoOnTour, type TourStop } from "@/components/AlsoOnTour";
import { SearchPageParamsSchema } from "@/application/events";
import { EventVisit } from "@/components/EventVisit";
import { shareText } from "@/components/lineup-copy";
import { groupByTier, isMatched } from "@/components/lineup-view";
import { parsePreview } from "@/components/playlist-preview";
import { LineupPoster } from "@/components/LineupPoster";
import { ticketLink } from "@/components/links";
import { PlaylistPanel } from "@/components/PlaylistPanel";
import { vibeOf, vibeTag, type Vibe } from "@/components/vibe-copy";
import { ShareButton } from "@/components/ShareButton";
import { EventBottomBar } from "@/components/EventBottomBar";
import { SectionBoundary } from "@/components/ui/SectionBoundary";
import { ButtonLink } from "@/components/ui/Button";
import { noteVisitorDemand } from "@/server/demand";
import { events } from "@/server/events";
import { listenNow, playlistInside, sharedOrTourStatus } from "@/server/listen-now";
import { playlists } from "@/server/playlists";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ artist?: string }> };

/**
 * Null only when the event doesn't exist (unknown or malformed id); other failures reach
 * error.tsx. There is deliberately no loading.tsx on this route: streaming a fallback first
 * would send HTTP 200 before notFound() could set 404 (QA-UI-1).
 */
const loadEvent = cache(async (raw: string): Promise<EventDetail | null> => {
  try {
    return await events().getEvent(parseEventId(raw));
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "not_found") return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).id);
  return { title: event?.title ?? "Event not found" };
}

export default async function EventPage({ params, searchParams }: Params) {
  const event = await loadEvent((await params).id);
  const { artist } = await searchParams;
  if (!event) notFound();
  await noteVisitorDemand("view"); // D-081: city-level count only, recorded after the response.

  const now = new Date();
  const groups = groupByTier(event.lineup);
  // Server-render the playlist state so a ready playlist shows "Open in Spotify" at once,
  // never a flash of "Make playlist". Falls back to the client check if this fails.
  // Serialised exactly like the GET route (Dates → ISO strings) so the client parser accepts it.
  // A build in progress carries its job's progress (read-only, no build work), so a paused
  // build shows "Spotify asked us to slow down…" on first paint, not "Joining the build…".
  const initialPlaylistStatus: unknown = await playlists()
    .getSharedStatus(event.id)
    .then(async (s) =>
      s.status === "none"
        ? sharedOrTourStatus(event.id)
        : s.status === "building"
          ? {
              ...s,
              progress: await playlists()
                .getProgress(s.jobId)
                .catch(() => undefined),
            }
          : s,
    )
    .then((s) => JSON.parse(JSON.stringify(s)) as unknown)
    .catch(() => null);
  // The engine's real plan for the show (D-065), server-rendered so the numbers never flash.
  // Serialised like the estimate route; anything unexpected shows no numbers.
  const preview = await playlists()
    .estimatePlaylist(event.id)
    .then((p) => parsePreview(JSON.parse(JSON.stringify(p)) as unknown))
    .catch(() => null);

  const playUrl = readyUrl(initialPlaylistStatus);
  const inside = await playlistInside(playUrl);
  // No playlist yet: the bottom bar still plays something (the top-billed artist on Spotify).
  const fallbackPlay = playUrl
    ? null
    : await listenNow(event.id)
        .then((d) => d?.artists[0] ?? null)
        .catch(() => null);
  const vibe = vibeOf(event.genre, event.type);
  // One headliner touring: the other dates, for "Also on this tour".
  const headliner = groups[0]?.artists.length === 1 ? groups[0].artists[0]!.name : null;
  const tourStops = headliner ? await alsoOnTour(headliner, event.id, now) : [];
  const more = await morePlaylists(event, vibe, now);
  const moreTitle = `More ${vibeTag(vibe)?.label ?? ""} playlists`.replace("  ", " ");
  const names = [...event.lineup].sort((x, y) => x.billingRank - y.billingRank).map((a) => a.name);
  const outbound = ticketLink(event.sources.map((s) => s.url));
  // UX #5: the secondary row. Other teams mount one-liners here (e.g. a "Remind me" button).
  const actions = (
    <>
      <ShareButton title={event.title} text={shareText(event.title, names)} />
      <EventActions event={event} now={now} />
      {outbound && (
        <ButtonLink
          href={outbound.url}
          external
          variant="secondary"
          ticketFor={outbound.kind === "tickets" ? event.id : undefined}
        >
          {outbound.label}
        </ButtonLink>
      )}
    </>
  );

  return (
    <div data-vibe={vibe} className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <EventVisit eventId={event.id} highlight={Boolean(artist)} />
      <EventHeader
        event={event}
        now={now}
        playUrl={playUrl}
        fallbackPlay={fallbackPlay}
        inside={inside?.tracks ?? []}
      />
      {event.archived && (
        // D-070: reachable by its link, clearly in the past.
        <p role="note" className="mt-3 font-display text-lg font-bold">
          This happened on {formatDateRange(event.startsAt, event.endsAt)}
        </p>
      )}
      {/* UX #5: the playlist card is the one primary action, right under the header on phones
          and in the sticky side column on desktop. */}
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        {groups.length > 0 ? (
          <div className="lg:sticky lg:top-24 lg:order-2">
            <SectionBoundary label="The playlist">
              <PlaylistPanel
                initialStatus={initialPlaylistStatus}
                eventId={event.id}
                vibe={vibe}
                inside={inside}
                actions={actions}
                preview={preview}
                matched={event.lineup.filter((a) => isMatched(a.matchStatus)).length}
                total={event.lineup.length}
              />
            </SectionBoundary>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 lg:order-2">{actions}</div>
        )}
        {/* A solo show's face already leads the header and the story: no third copy. */}
        {event.lineup.length > 1 && (
          <div className="lg:order-1">
            <SectionBoundary label="The lineup">
              <LineupPoster lineup={event.lineup} highlight={artist} />
            </SectionBoundary>
          </div>
        )}
      </div>
      {headliner && <AlsoOnTour artist={headliner} stops={tourStops} now={now} />}
      {/* Playlist first (user, 24 Nov): the page ends in more playlists of the same vibe, not a
          story card repeating the header. */}
      {more.length > 0 && (
        <section aria-label={moreTitle} className="reveal mt-12">
          <SectionBoundary label="More playlists">
            <HotRail kicker={moreTitle} items={more} bleed="page" radioGig={event.id} />
          </SectionBoundary>
        </section>
      )}
      <EventBottomBar>
        <PlayCta eventId={event.id} playUrl={playUrl} fallback={fallbackPlay} className="flex-1" />
        <ShareButton title={event.title} text={shareText(event.title, names)} size="lg" />
      </EventBottomBar>
    </div>
  );
}

/** The headliner's other upcoming dates (search by artist), this one left out. Never throws. */
async function alsoOnTour(artist: string, eventId: string, now: Date): Promise<TourStop[]> {
  try {
    const r = await events().searchPage(
      SearchPageParamsSchema.parse({ artist, from: now.toISOString(), pageSize: "30" }),
    );
    return r.results
      .filter((e) => e.id !== eventId)
      .map((e) => ({ id: e.id, city: e.city, startsAt: new Date(e.startsAt) }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  } catch {
    return [];
  }
}

/**
 * "More EDM playlists": other upcoming gigs of the same vibe with a playlist, one per artist,
 * never this gig's tour. Falls back to any playlists when the vibe has too few. Never throws.
 */
async function morePlaylists(event: EventDetail, vibe: Vibe, now: Date) {
  try {
    const mine = new Set(event.lineup.map((a) => a.name));
    const rows = (await upcomingRows(now)).filter(
      (r) => r.playlistUrl && r.id !== event.id && !r.headliners.some((h) => mine.has(h)),
    );
    const same = rows.filter((r) => vibeOf(r.genre, r.type) === vibe);
    const pool = same.length >= 3 ? same : [...same, ...rows.filter((r) => !same.includes(r))];
    const seen = new Set<string>();
    return pool
      .filter((r) => {
        const key = r.headliners[0] ?? r.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        title: shortTitle(e.title, e.headliners[0]),
        when: [shortDate(e.startsAt, now), e.city].filter(Boolean).join(" · "),
        poster: e.posterUrl ?? null,
        artists: e.headlinerArtists,
        label: e.headliners[0] ?? e.title,
        playlistUrl: e.playlistUrl!,
        vibe: vibeOf(e.genre, e.type),
      }));
  } catch {
    return [];
  }
}

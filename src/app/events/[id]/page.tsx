import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { parseEventId } from "@/application/events";
import type { EventDetail } from "@/application/ports/events";
import { EventHeader } from "@/components/EventHeader";
import { EventStory } from "@/components/EventStory";
import { EventVisit } from "@/components/EventVisit";
import { shareText } from "@/components/lineup-copy";
import { groupByTier, isMatched } from "@/components/lineup-view";
import { parsePreview } from "@/components/playlist-preview";
import { LineupPoster } from "@/components/LineupPoster";
import { ticketUrl } from "@/components/links";
import { PlaylistPanel } from "@/components/PlaylistPanel";
import { ShareButton } from "@/components/ShareButton";
import { BottomBar } from "@/components/ui/BottomBar";
import { ButtonLink } from "@/components/ui/Button";
import { events } from "@/server/events";
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

  const now = new Date();
  const groups = groupByTier(event.lineup);
  // Server-render the playlist state so a ready playlist shows "Open in Spotify" at once,
  // never a flash of "Make playlist". Falls back to the client check if this fails.
  // Serialised exactly like the GET route (Dates → ISO strings) so the client parser accepts it.
  const initialPlaylistStatus: unknown = await playlists()
    .getSharedStatus(event.id)
    .then((s) => JSON.parse(JSON.stringify(s)) as unknown)
    .catch(() => null);
  // The engine's real plan for the show (D-065), server-rendered so the numbers never flash.
  // Serialised like the estimate route; anything unexpected shows no numbers.
  const preview = await playlists()
    .estimatePlaylist(event.id)
    .then((p) => parsePreview(JSON.parse(JSON.stringify(p)) as unknown))
    .catch(() => null);
  const venueLine = event.venue ? `📍 ${event.venue.name}, ${event.venue.city}` : "📍 Venue TBA";

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <EventVisit eventId={event.id} highlight={Boolean(artist)} />
      <EventHeader event={event} ticketUrl={ticketUrl(event.sources)} now={now} />
      {groups.length > 0 && (
        <div className="mt-12">
          <EventStory event={event} now={now} preview={preview} />
        </div>
      )}
      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <LineupPoster
          title={event.title}
          venueLine={venueLine}
          lineup={event.lineup}
          highlight={artist}
        />
        {groups.length > 0 && (
          <div className="lg:sticky lg:top-24">
            <PlaylistPanel
              initialStatus={initialPlaylistStatus}
              eventId={event.id}
              eventTitle={event.title}
              preview={preview}
              matched={event.lineup.filter((a) => isMatched(a.matchStatus)).length}
              total={event.lineup.length}
              soloName={event.lineup.length === 1 ? event.lineup[0]!.name : undefined}
              tierCount={groups.length}
            />
          </div>
        )}
      </div>
      <BottomBar label="Event actions">
        <ButtonLink href="#playlist" size="lg" className="flex-1">
          <span aria-hidden>🎧</span> Get the playlist
        </ButtonLink>
        <ShareButton
          title={event.title}
          text={shareText(
            event.title,
            [...event.lineup].sort((a, b) => a.billingRank - b.billingRank).map((a) => a.name),
          )}
          size="lg"
        />
      </BottomBar>
    </div>
  );
}

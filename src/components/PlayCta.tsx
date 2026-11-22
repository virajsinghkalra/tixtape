import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { ButtonLink } from "./ui/Button";
import { EqBars } from "./ui/EqBars";

/**
 * The event page's one primary action. A ready playlist (own or its tour's) opens Spotify in one
 * tap; otherwise the button scrolls to the playlist panel, which shows the cooking message.
 */
export function PlayCta({
  eventId,
  playUrl,
  className,
}: {
  eventId: string;
  playUrl: string | null;
  className?: string;
}) {
  if (playUrl) {
    return (
      <SpotifyOpenLink href={playUrl} eventId={eventId} className={className}>
        <EqBars /> Play setlist
      </SpotifyOpenLink>
    );
  }
  return (
    <ButtonLink href="#playlist" size="lg" className={className}>
      <span aria-hidden>🎧</span> Playlist
    </ButtonLink>
  );
}

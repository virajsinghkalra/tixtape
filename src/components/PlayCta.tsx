import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { ButtonLink } from "./ui/Button";
import { EqBars } from "./ui/EqBars";

/**
 * The event page's one primary action. A ready playlist (own or its tour's) opens Spotify in one
 * tap; otherwise it plays the top-billed artist on Spotify (or, failing that, scrolls to the panel).
 */
export function PlayCta({
  eventId,
  playUrl,
  fallback = null,
  className,
}: {
  eventId: string;
  playUrl: string | null;
  /** No playlist yet: the top-billed artist on Spotify, so the button still plays. */
  fallback?: { name: string; url: string } | null;
  className?: string;
}) {
  if (playUrl) {
    return (
      <SpotifyOpenLink href={playUrl} eventId={eventId} className={className}>
        <EqBars /> Play setlist
      </SpotifyOpenLink>
    );
  }
  if (fallback) {
    return (
      <SpotifyOpenLink href={fallback.url} eventId={eventId} className={className}>
        <span aria-hidden>▶</span> Play {fallback.name}
      </SpotifyOpenLink>
    );
  }
  return (
    <ButtonLink href="#playlist" size="lg" className={className}>
      <span aria-hidden>🎧</span> Playlist
    </ButtonLink>
  );
}

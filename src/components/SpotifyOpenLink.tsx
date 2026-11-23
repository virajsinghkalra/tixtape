"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { notePlayed } from "./after-play";
import { currentEventId, track } from "./analytics/track";
import { currentPlatform } from "./platform";
import { spotifyOpenPlan } from "./spotify-link";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { cx } from "./ui/cx";
import { COPY } from "./ux-copy";

type Props = {
  /** The open.spotify.com URL. It stays the link's `href` (copy link, middle-click, no JS). */
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** For cards outside the event page (home), whose URL doesn't name the event. */
  eventId?: string;
};

/**
 * "Open in Spotify" that opens the app (UX #10, D-088). Android: an intent with the web URL as
 * its fallback. iOS: the `spotify:` scheme, then the web URL if the page is still showing after
 * 1.2 s. Desktop: the web URL in a new tab. Inside Instagram, Facebook or WhatsApp, where the
 * app often can't be reached, a stuck tap shows a tiny "⋯ → Open in browser" hint instead.
 */
export function SpotifyOpenLink({
  href,
  children,
  variant,
  size = "lg",
  className,
  eventId,
}: Props) {
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    const id = eventId ?? currentEventId();
    track("playlist_open_spotify", { eventId: id });
    notePlayed(id);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab: let it be
    const platform = currentPlatform();
    const plan = spotifyOpenPlan(href, platform);
    if (plan.kind === "web") return;
    e.preventDefault();
    window.location.href = plan.href;
    if (plan.kind !== "scheme") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (document.visibilityState !== "visible") return; // the app opened
      if (platform.inApp) setHint(true);
      else window.location.href = plan.web;
    }, plan.fallbackMs);
  }

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={buttonClass(variant, size, "w-full")}
      >
        {children}
        <span className="sr-only"> (opens Spotify)</span>
      </a>
      {hint && (
        <p role="status" className="flex items-center justify-between gap-2 text-sm font-semibold">
          <span>
            {COPY.openInBrowser} <span aria-hidden>↗</span>
          </span>
          <button
            type="button"
            onClick={() => setHint(false)}
            className="grid size-11 place-items-center rounded-full hover:bg-surface-2"
            aria-label={COPY.dismiss}
          >
            <span aria-hidden>×</span>
          </button>
        </p>
      )}
    </div>
  );
}

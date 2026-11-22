/**
 * UX #10 (D-088): open Spotify links in the Spotify app, not the in-app webview's web player.
 * Pure: builds the links; `SpotifyOpenLink` does the navigation. No Spotify API calls.
 */
import type { Platform } from "./platform";

export type SpotifyKind = "playlist" | "album" | "track" | "artist";
export type SpotifyRef = { kind: SpotifyKind; id: string };

const PATH =
  /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(playlist|album|track|artist)\/([A-Za-z0-9]{10,40})\/?$/;

/** `https://open.spotify.com/playlist/37i9…?si=…` → { kind: "playlist", id: "37i9…" }. */
export function parseSpotifyUrl(url: string): SpotifyRef | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "open.spotify.com") return null;
    const m = PATH.exec(u.pathname);
    return m ? { kind: m[1] as SpotifyKind, id: m[2]! } : null;
  } catch {
    return null;
  }
}

export type SpotifyOpenPlan =
  /** Android: an intent with a browser fallback built in. */
  | { kind: "intent"; href: string; web: string }
  /** iOS: the app scheme, then the web URL if the page is still visible after `fallbackMs`. */
  | { kind: "scheme"; href: string; web: string; fallbackMs: number }
  /** Desktop or anything we can't parse: the https link, as before. */
  | { kind: "web"; web: string };

export const IOS_FALLBACK_MS = 1200;

export function spotifyOpenPlan(webUrl: string, platform: Platform): SpotifyOpenPlan {
  const ref = parseSpotifyUrl(webUrl);
  if (!ref || platform.os === "other") return { kind: "web", web: webUrl };
  // iOS Safari: the https link is a universal link: the app opens if installed, else the web
  // page with the tracklist. The bare `spotify:` scheme errors out when the app is missing.
  if (platform.os === "ios" && platform.inApp === null) return { kind: "web", web: webUrl };
  if (platform.os === "android") {
    const href =
      `intent://${ref.kind}/${ref.id}#Intent;scheme=spotify;package=com.spotify.music;` +
      `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
    return { kind: "intent", href, web: webUrl };
  }
  return {
    kind: "scheme",
    href: `spotify:${ref.kind}:${ref.id}`,
    web: webUrl,
    fallbackMs: IOS_FALLBACK_MS,
  };
}

/**
 * What kind of browser this is, from the user agent only (UX #2, #10; D-088). Pure, so it can be
 * tested with real UA strings. Used to pick the calendar route and the Spotify deep link.
 */
export type InAppBrowser = "instagram" | "facebook" | "whatsapp" | "line";
export type Platform = { os: "ios" | "android" | "other"; inApp: InAppBrowser | null };

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  const ua = userAgent;
  const android = /Android/i.test(ua);
  // iPadOS 13+ reports a Mac UA; touch points tell them apart.
  const ios =
    !android && (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1));
  return { os: ios ? "ios" : android ? "android" : "other", inApp: inAppBrowser(ua) };
}

function inAppBrowser(ua: string): InAppBrowser | null {
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(ua)) return "facebook";
  if (/WhatsApp/i.test(ua)) return "whatsapp";
  if (/\bLine\//.test(ua)) return "line";
  return null;
}

/** The browser's platform, or "other" during server rendering. */
export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return { os: "other", inApp: null };
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export type RemindRoute = "ics" | "google" | "choose";

/**
 * UX #2 smart default: iOS Safari opens a .ics in the native "Add event" sheet; Android and
 * in-app webviews (where a .ics download fails silently) get Google Calendar; desktop chooses.
 */
export function remindRoute(p: Platform): RemindRoute {
  if (p.inApp) return "google";
  if (p.os === "ios") return "ics";
  if (p.os === "android") return "google";
  return "choose";
}

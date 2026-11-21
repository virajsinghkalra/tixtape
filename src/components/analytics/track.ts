/**
 * D-090: anonymous product analytics in the browser. `track(name, props)` queues an
 * allow-listed event; batches go to `POST /api/t` with `navigator.sendBeacon` (fetch keepalive
 * as the fallback), fire-and-forget, never blocking the UI.
 *
 * Skipped entirely under Do Not Track, Global Privacy Control and automated browsers. Only the
 * referrer's host name ever leaves the page, never a URL.
 */
import type { AnalyticsEventName, AnalyticsProps, RawSource } from "@/domain/analytics/beacon";
import type { ContactSource } from "@/domain/analytics/identity";
import { valueMoment } from "../identity/value-moment";
import { deviceId } from "./device-id";

export const BEACON_URL = "/api/t";
const FLUSH_AFTER_MS = 2_000;
const MAX_BATCH = 10;
const SOURCE_KEY = "tixtape.src";
/** A repeated identical search within this window is one search. */
const SEARCH_DEDUPE_MS = 60_000;

type PrivacySignals = {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  webdriver?: boolean;
  windowDoNotTrack?: string | null;
};

/** False under DNT, GPC or an automated browser (bots never count). */
export function trackingAllowed(s: PrivacySignals): boolean {
  if (s.doNotTrack === "1" || s.doNotTrack === "yes" || s.windowDoNotTrack === "1") return false;
  if (s.globalPrivacyControl === true) return false;
  return s.webdriver !== true;
}

/** Where this visit came from, read from the landing URL: UTM tags, `?via=`, referrer host. */
export function landingSource(href: string, referrer: string): RawSource {
  const url = new URL(href);
  const q = url.searchParams;
  const src: RawSource = {};
  const set = (key: keyof RawSource, value: string | null, max: number) => {
    if (value) src[key] = value.slice(0, max);
  };
  set("us", q.get("utm_source"), 60);
  set("um", q.get("utm_medium"), 60);
  set("uc", q.get("utm_campaign"), 80);
  set("via", q.get("via"), 12);
  try {
    if (referrer) {
      const ref = new URL(referrer);
      // Android apps send android-app://<package>/; keep the package as the "host".
      const host = ref.protocol === "android-app:" ? ref.hostname || ref.pathname : ref.hostname;
      if (host && host !== url.hostname) set("ref", host, 253);
    }
  } catch {
    // An unparsable referrer is "direct".
  }
  return src;
}

/** The value moments that may offer "Email me too? ✉️". */
const VALUE_MOMENTS: Partial<Record<AnalyticsEventName, ContactSource>> = {
  remind: "remind",
  ping_me: "ping_me",
  follow: "follow",
};

type Queued = { n: AnalyticsEventName; p: Record<string, unknown> };

const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
const recentSearches = new Map<string, number>();

function allowed(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    return trackingAllowed({
      doNotTrack: nav.doNotTrack,
      globalPrivacyControl: nav.globalPrivacyControl,
      webdriver: nav.webdriver,
      windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack ?? null,
    });
  } catch {
    return false;
  }
}

/** Read once per tab session, so every beacon of the visit carries the landing source. */
function sessionSource(): RawSource {
  try {
    const saved = sessionStorage.getItem(SOURCE_KEY);
    if (saved) return JSON.parse(saved) as RawSource;
    const src = landingSource(window.location.href, document.referrer);
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(src));
    return src;
  } catch {
    return {};
  }
}

export function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0) return;
  const did = deviceId();
  const ev = queue.splice(0, queue.length);
  if (!did) return;
  try {
    const body = JSON.stringify({ did, src: sessionSource(), ev });
    if (navigator.sendBeacon?.(BEACON_URL, body)) return;
    void fetch(BEACON_URL, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Measurement is best-effort.
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function duplicateSearch(p: Record<string, unknown>): boolean {
  const key = String(p.q ?? "")
    .trim()
    .toLowerCase();
  const now = Date.now();
  const last = recentSearches.get(key);
  recentSearches.set(key, now);
  return last !== undefined && now - last < SEARCH_DEDUPE_MS;
}

export function track<N extends AnalyticsEventName>(name: N, props?: AnalyticsProps<N>): void {
  const moment = VALUE_MOMENTS[name];
  if (moment) valueMoment(moment);
  if (typeof window === "undefined" || !allowed()) return;
  const p = (props ?? {}) as Record<string, unknown>;
  if (name === "search" && duplicateSearch(p)) return;
  queue.push({ n: name, p });
  listen();
  if (queue.length >= MAX_BATCH) flush();
  else timer ??= setTimeout(flush, FLUSH_AFTER_MS);
}

const EVENT_PATH = /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/** The event ID of the page we're on, if it's an event page. */
export function currentEventId(pathname?: string): string | undefined {
  try {
    return EVENT_PATH.exec(pathname ?? window.location.pathname)?.[1];
  } catch {
    return undefined;
  }
}

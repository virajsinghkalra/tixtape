/* Tixtape service worker (D-084, UX plan #14). Hand-written, no dependencies.
 *
 * - Navigations: network first; a saved copy if the network is slower than 3 s; /offline when
 *   the network fails and nothing is saved.
 * - The home page and the last 10 event pages are kept for offline reading.
 * - /_next/static/* and icons: cache first (file names are content-hashed or stable).
 * - Everything else, including /api/*, RSC fetches, OG images and other origins: not touched.
 * - Updates wait; the page asks the visitor ("New version · Refresh"), then posts SKIP_WAITING.
 */
const VERSION = "v1";
const SHELL = `tixtape-shell-${VERSION}`;
const PAGES = `tixtape-pages-${VERSION}`;
const STATIC = `tixtape-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/icon.svg",
  "/manifest.webmanifest",
];
const MAX_EVENT_PAGES = 10;
const NETWORK_TIMEOUT_MS = 3000;
const EVENT_PAGE = /^\/events\/[0-9a-f-]{36}\/?$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      // One missing file must not block the install.
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, PAGES, STATIC]);
      for (const key of await caches.keys()) {
        if (key.startsWith("tixtape-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;
    event.respondWith(navigate(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || /^\/(icon|apple-icon)/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

async function navigate(event) {
  const { request } = event;
  const url = new URL(request.url);
  const keep = url.pathname === "/" || EVENT_PAGE.test(url.pathname);
  const network = fetch(request).then((response) => {
    if (keep && response.ok && response.type === "basic") {
      event.waitUntil(remember(url.pathname, response.clone()));
    }
    return response;
  });
  const saved = () => caches.match(url.pathname, { cacheName: PAGES });
  // Slow network: a saved copy after 3 s beats a blank screen. With no saved copy, keep waiting:
  // a slow page is better than a wrong "You're offline".
  const slow = sleep(NETWORK_TIMEOUT_MS)
    .then(saved)
    .then((hit) => hit ?? network);
  try {
    return await Promise.race([network, slow]);
  } catch {
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL });
    return (
      (await saved()) ??
      offline ??
      new Response("You're offline", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

/** Keeps a page under its path (no query), trimming to the newest MAX_EVENT_PAGES events. */
async function remember(path, response) {
  const cache = await caches.open(PAGES);
  await cache.delete(path);
  await cache.put(path, response);
  const events = (await cache.keys()).filter((r) => EVENT_PAGE.test(new URL(r.url).pathname));
  // keys() lists in insertion order, and a re-visit was deleted and re-added above.
  for (const old of events.slice(0, Math.max(0, events.length - MAX_EVENT_PAGES))) {
    await cache.delete(old);
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const copy = response.clone();
    caches.open(STATIC).then((cache) => cache.put(request, copy));
  }
  return response;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

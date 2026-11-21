"use client";

import { useEffect, useState } from "react";
import { savedPageTitle } from "./saved-pages";
import { sendUx } from "./ux-beacon";

type Saved = { href: string; title: string };

/** The event pages the service worker kept (D-084), readable without a connection. */
export function SavedGigs() {
  const [saved, setSaved] = useState<Saved[]>([]);

  useEffect(() => {
    sendUx({ metric: "offline_view" });
    if (!("caches" in window)) return;
    (async () => {
      const keys = (await caches.keys()).filter((k) => k.startsWith("tixtape-pages-"));
      const found: Saved[] = [];
      for (const key of keys) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          const href = new URL(request.url).pathname;
          if (!href.startsWith("/events/")) continue;
          const html = await (await cache.match(request))?.text();
          found.push({ href, title: savedPageTitle(html ?? "") });
        }
      }
      setSaved(found.reverse());
    })().catch(() => {});
  }, []);

  if (saved.length === 0) return null;
  return (
    <section aria-labelledby="saved-gigs" className="mt-12 w-full text-left">
      <h2 id="saved-gigs" className="font-display text-big font-extrabold">
        Saved gigs
      </h2>
      <ul className="mt-4 grid gap-3">
        {saved.map((s) => (
          <li key={s.href}>
            {/* A full page load: the service worker answers it from its cache. */}
            <a
              href={s.href}
              className="flex min-h-14 items-center gap-3 rounded-card border-2 border-night bg-surface px-4 font-semibold shadow-[3px_4px_0_0_var(--color-night)] active:translate-y-0.5 active:shadow-none"
            >
              <span aria-hidden>🎟️</span> {s.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

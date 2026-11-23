"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pathGroup } from "@/domain/analytics/beacon";
import { currentEventId, track } from "./track";
import { notePlayed } from "../after-play";

/**
 * D-090: one `page_view` per route (as a path group, never the path), and a delegated click
 * listener for server-rendered links tagged `data-track="ticket_click"` (no client code needed
 * in the link). Admin pages are never tracked.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    track("page_view", { path: pathGroup(pathname) });
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[data-track]");
      const kind = link?.getAttribute("data-track");
      if (!link || (kind !== "ticket_click" && kind !== "playlist_open_spotify")) return;
      const eventId = link.getAttribute("data-track-event") || currentEventId();
      track(kind, eventId ? { eventId } : {});
      if (kind === "playlist_open_spotify") notePlayed(eventId);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}

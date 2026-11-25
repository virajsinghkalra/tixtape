"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pathGroup } from "@/domain/analytics/beacon";
import { currentEventId, flush, track } from "./track";
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

  // Funnel (25 Nov): how far down a page people get, and how long they stay, so "left after
  // one page" can tell a 2-second bounce from a full scroll.
  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    const path = pathGroup(pathname);
    const start = Date.now();
    const marks = [25, 50, 75, 100] as const;
    let reached = 0;
    let left = false;
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = ((window.scrollY + 1) / max) * 100;
      for (const m of marks) {
        if (m > reached && pct >= m - 1) {
          reached = m;
          track("scroll_depth", { path, pct: m });
        }
      }
    };
    const leave = () => {
      if (left) return;
      left = true;
      const secs = Math.min(3_600, Math.round((Date.now() - start) / 1000));
      track("page_leave", { path, secs });
      flush();
    };
    const onHide = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onHide);
      leave();
    };
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

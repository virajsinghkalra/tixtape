"use client";

import { useEffect } from "react";
import { track } from "./analytics/track";

/** Scrolls the highlighted lineup artist into view (D-048 C) and logs one view per visit. */
export function EventVisit({ eventId, highlight }: { eventId: string; highlight: boolean }) {
  useEffect(() => {
    if (highlight) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("highlighted-artist")?.scrollIntoView({
        block: "center",
        behavior: reduce ? "auto" : "smooth",
      });
    }
    try {
      const key = `viewed:${eventId}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: log anyway; the stats rollup counts one open per device and day.
    }
    // QA-F-7: this one analytics event feeds `event_stats` (the nightly rollup), no extra call.
    track("event_open", { eventId });
  }, [eventId, highlight]);
  return null;
}

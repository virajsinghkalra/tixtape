"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BottomBar } from "./ui/BottomBar";

/**
 * UX #5: the event page's phone action bar never duplicates what's on screen. It slides away
 * while the playlist card (#playlist) is at least half visible, and comes back after.
 */
export function EventBottomBar({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const target = document.getElementById("playlist");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setHidden(Boolean(entry?.isIntersecting)), {
      threshold: 0.5,
    });
    io.observe(target);
    return () => io.disconnect();
  }, []);
  return (
    <BottomBar label="Event actions" hidden={hidden}>
      {children}
    </BottomBar>
  );
}

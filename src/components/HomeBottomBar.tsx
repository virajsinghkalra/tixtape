"use client";

import { useEffect, useState } from "react";
import { SEARCH_INPUT_ID } from "./search/EventSearch";
import { SearchLauncher } from "./SearchLauncher";
import { RadioLink } from "./radio/RadioLink";
import { BottomBar } from "./ui/BottomBar";

/**
 * Home's "Find a gig" bar (user, 25 Nov: on the first screen the hero's search and this bar
 * stacked up as two green blocks). It waits until the hero search box has scrolled away.
 */
export function HomeBottomBar() {
  const [searchOnScreen, setSearchOnScreen] = useState(true);
  useEffect(() => {
    const el = document.getElementById(SEARCH_INPUT_ID);
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setSearchOnScreen(entry!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <BottomBar label="Quick actions" hidden={searchOnScreen}>
      <SearchLauncher />
      <RadioLink
        aria-label="Gig Radio"
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-night text-xl text-lime"
      >
        <span aria-hidden>📻</span>
      </RadioLink>
    </BottomBar>
  );
}

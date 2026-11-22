"use client";

import { useEffect } from "react";

/**
 * The shared "search is open" signal: `<body data-search-open>`. Search sets it while its
 * sheet/dropdown is open; anything that must get out of the way hides with the CSS selector
 * `body[data-search-open] …` (globals.css hides `[data-bottom-bar]`). No context needed.
 */
export const SEARCH_OPEN_ATTR = "data-search-open";

export function setSearchOpen(open: boolean): void {
  if (typeof document === "undefined") return;
  if (open) document.body.setAttribute(SEARCH_OPEN_ATTR, "");
  else document.body.removeAttribute(SEARCH_OPEN_ATTR);
}

/** Mirrors `open` onto `<body>`, and clears it on unmount (e.g. navigating away mid-search). */
export function useSearchOpenSignal(open: boolean): void {
  useEffect(() => {
    setSearchOpen(open);
    return () => setSearchOpen(false);
  }, [open]);
}

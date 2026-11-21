"use client";

import { SEARCH_INPUT_ID } from "./search/EventSearch";
import { Button } from "./ui/Button";

/** Bottom-bar shortcut that opens the search sheet by focusing the search box. */
export function SearchLauncher() {
  return (
    <Button
      size="lg"
      className="flex-1"
      onClick={() => document.getElementById(SEARCH_INPUT_ID)?.focus()}
    >
      <span aria-hidden>🔍</span> Find a gig
    </Button>
  );
}

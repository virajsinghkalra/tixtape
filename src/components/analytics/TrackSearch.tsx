"use client";

import { useEffect } from "react";
import { track } from "./track";

/** D-090: the full results page counts its search once (repeats within a minute are merged). */
export function TrackSearch({ q, results }: { q: string; results: number }) {
  useEffect(() => {
    const query = q.trim().slice(0, 100);
    if (query) track("search", { q: query, results });
  }, [q, results]);
  return null;
}

"use client";

import { useEffect, useState } from "react";
import type { ShowRowItem } from "../ShowRow";
import { worthLookingUp } from "./live-lookup";
import { fetchSimilar } from "./similar";

/** "Sounds like this" for a settled artist name (null: don't ask). Never waits on the lookup. */
export function useSimilarShows(artist: string | null): ShowRowItem[] {
  const [items, setItems] = useState<ShowRowItem[]>([]);
  useEffect(() => {
    setItems([]);
    if (!artist || !worthLookingUp(artist)) return;
    const controller = new AbortController();
    void fetchSimilar(artist, controller.signal).then((found) => {
      if (!controller.signal.aborted) setItems(found);
    });
    return () => controller.abort();
  }, [artist]);
  return items;
}

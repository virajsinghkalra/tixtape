"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createEventSearch, IDLE, type SearchState } from "./event-search";
import { defaultSearchSource } from "./source";
import type { SearchSource } from "./types";

/** React binding for the type-ahead engine. All behaviour lives in `createEventSearch`. */
export function useEventSearch(source: SearchSource = defaultSearchSource): {
  state: SearchState;
  setQuery: (raw: string, city?: string) => void;
  retry: () => void;
} {
  const [engine] = useState(() => createEventSearch({ source }));
  useEffect(() => () => engine.dispose(), [engine]);
  const state = useSyncExternalStore(engine.subscribe, engine.getState, () => IDLE);
  return { state, setQuery: engine.setQuery, retry: engine.retry };
}

"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../ui/cx";
import { EASE_OUT_EXPO } from "../ui/motion";
import { Sheet } from "../ui/Sheet";
import { MAX_CHARS, MIN_CHARS, normalizeQuery, type SearchState } from "./event-search";
import { EventShell } from "./EventShell";
import { liveLookup, worthLookingUp, type LookupView } from "./live-lookup";
import { cityChips, dateChips } from "./quick-chips";
import { pushRecent, readRecent, writeRecent } from "./recent-searches";
import { RUN_SEARCH_EVENT } from "./run-search";
import { RecommendationsPanel, ResultsPanel } from "./SearchPanels";
import {
  artistHref,
  buildGroups,
  cityHref,
  flatten,
  ghostCompletion,
  localMatches,
  withoutFilter,
  type FilterChip,
  type SearchOption,
} from "./search-view";
import { fetchRecommendations, logSearchClick, SEARCH_CAPABILITIES } from "./source";
import type { EventResult, RecommendationSection } from "./types";
import { useEventSearch } from "./useEventSearch";
import { track } from "../analytics/track";

/** One search box per page; the bottom bar focuses it by this id. */
export const SEARCH_INPUT_ID = "event-search";

const PHONE = "(max-width: 639px)";
const NAVIGATION_FALLBACK_MS = 6000;

type Props = {
  /** From `?q=`: restores the query (and its results) after Back or a shared link. */
  initialQuery?: string;
  /** Prefetched recommendations, shown on focus with no spinner (D-048 A). */
  sections?: RecommendationSection[];
  /** The visitor's city (D-050): "Near you" recommendations follow it. */
  city?: string | null;
  /**
   * Re-open the dropdown with `?q=`'s results on load. Off on /search, where the page already
   * lists them (re-opening there pushed the grid down: CLS 0.6).
   */
  restoreResults?: boolean;
};

/**
 * The search journey (D-042, D-047, D-048): recommendations before typing, instant local and
 * debounced server results while typing, ghost completion, filter chips, grouped options
 * (Artists, Cities, Events) and the right destination for each kind of click.
 */
export function EventSearch({
  initialQuery: fromServer = "",
  sections: initialSections = [],
  city = null,
  restoreResults = true,
}: Props) {
  const router = useRouter();
  // Back restores the page from the router cache, so read `?q=` from the live URL too.
  const initialQuery = useSearchParams().get("q") ?? fromServer;
  const reduceMotion = useReducedMotion();
  const { state, setQuery, retry } = useEventSearch();
  // D-090: a settled search (no new keystroke for 1.5 s) counts once, with its result count.
  useEffect(() => {
    if (state.status !== "done" || state.query.length < MIN_CHARS) return;
    const results = state.response.results.length;
    const timer = setTimeout(() => track("search", { q: state.query, results }), 1500);
    return () => clearTimeout(timer);
  }, [state]);
  const listboxId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sheetEntry = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fallbackTimer.current), []);
  const [value, setValue] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [within, setWithin] = useState(false);
  const [restored, setRestored] = useState(
    restoreResults && initialQuery.trim().length >= MIN_CHARS,
  );
  const [sheet, setSheet] = useState(false);
  // The highlight follows an option's key, so it survives local → server results.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [sections, setSections] = useState(initialSections);
  const [opening, setOpening] = useState<EventResult | null>(null);
  const [lookup, setLookup] = useState<LookupView>({ kind: "idle" });

  const typed = value.trim().length >= MIN_CHARS;
  const serverGroups = useMemo(() => buildGroups(state.response), [state.response]);
  const local = state.status === "loading" && !state.stale;
  // The last answered results also feed the instant local matches (D-057).
  const lastResults = useRef<EventResult[]>([]);
  if (state.status === "done" && state.response.results.length > 0) {
    lastResults.current = state.response.results;
  }
  const groups = useMemo(
    () =>
      local
        ? localMatches(value, recent, [
            ...sections,
            { id: "up_next", title: "", items: lastResults.current },
          ])
        : serverGroups,
    [local, value, recent, sections, serverGroups],
  );
  const options = useMemo(() => flatten(groups), [groups]);
  const active = activeKey === null ? -1 : options.findIndex((o) => o.key === activeKey);
  const setActive = useCallback(
    (next: number | ((current: number) => number)) =>
      setActiveKey((key) => {
        const current = key === null ? -1 : options.findIndex((o) => o.key === key);
        const index = typeof next === "function" ? next(current) : next;
        return options[index]?.key ?? null;
      }),
    [options],
  );
  const showResults = (focused || restored) && typed && state.status !== "idle";
  // UX #11: date chips are always there, so the empty sheet is never blank.
  const showRecommendations = within && !typed;
  const top = state.status === "done" ? state.response.results[0] : undefined;
  const ghost = focused ? ghostCompletion(value, top) : "";

  // Restore a query from the URL; load recents; prefetch recommendations once live (D-048 A).
  useEffect(() => {
    setRecent(readRecent());
    if (initialQuery) setQuery(initialQuery);
    if (!SEARCH_CAPABILITIES.recommendations) return;
    const controller = new AbortController();
    fetchRecommendations(controller.signal, city)
      .then(setSections)
      .catch(() => {});
    return () => controller.abort();
    // Run once on mount: later changes come from typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nothing matched: ask the live lookup (D-050) whether the artist plays India after all.
  const noMatch = state.status === "done" && serverGroups.length === 0;
  useEffect(() => {
    if (!noMatch || !worthLookingUp(state.query)) {
      setLookup({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    const query = state.query;
    setLookup({ kind: "looking", query, artist: null });
    void liveLookup(query, controller.signal, {
      onUpdate: (view) => !controller.signal.aborted && setLookup(view),
    }).then((view) => {
      if (!controller.signal.aborted) setLookup(view ?? { kind: "idle" });
    });
    return () => controller.abort();
  }, [noMatch, state.query]);

  // Phone: the device back button closes the search sheet instead of leaving the page.
  useEffect(() => {
    const onPop = () => {
      if (!sheetEntry.current) return;
      sheetEntry.current = false;
      setSheet(false);
      inputRef.current?.blur();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // "/" focuses the search from anywhere, unless the user is typing somewhere else.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "/" && !target?.closest("input, textarea, [contenteditable='true']")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Prefetch the highlighted event so opening it is instant.
  useEffect(() => {
    const o = options[active];
    if (o?.kind === "event") router.prefetch(`/events/${o.event.id}`);
  }, [active, options, router]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      setQuery(next);
      setRestored(false);
      setActiveKey(null);
      keepQueryInUrl(next);
    },
    [setQuery],
  );

  // Chips elsewhere on the page (e.g. "Try searching") fill the box and run the search.
  useEffect(() => {
    const onRun = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (typeof q !== "string") return;
      update(q);
      inputRef.current?.focus();
    };
    window.addEventListener(RUN_SEARCH_EVENT, onRun);
    return () => window.removeEventListener(RUN_SEARCH_EVENT, onRun);
  }, [update]);

  function openSheet() {
    setSheet(true);
    if (!sheetEntry.current && window.matchMedia(PHONE).matches) {
      sheetEntry.current = true;
      window.history.pushState(null, "", window.location.href);
    }
  }

  function closeSheet() {
    setSheet(false);
    inputRef.current?.blur();
    if (sheetEntry.current) {
      sheetEntry.current = false;
      window.history.back();
    }
  }

  /** Leaving for another page. Pushing keeps the sheet's entry, which carries `?q=` for Back. */
  function go(href: string) {
    sheetEntry.current = false;
    setSheet(false);
    router.push(href);
    // If client navigation stalls (a dev-server compile race, a flaky network), never leave
    // the user behind the shell: fall back to a full page load. Unmounting cancels this.
    clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => window.location.assign(href), NAVIGATION_FALLBACK_MS);
  }

  function remember(query: string) {
    const list = pushRecent(recent, query);
    setRecent(list);
    writeRecent(list);
  }

  function openEvent(e: EventResult) {
    remember(value);
    logSearchClick(value.trim(), e.id);
    setOpening(e);
    go(`/events/${e.id}`);
  }

  function choose(o: SearchOption) {
    if (o.kind === "query") return update(o.query);
    if (o.kind === "event") return openEvent(o.event);
    remember(value);
    go(o.kind === "artist" ? artistHref(o.artist, state.response.results) : cityHref(o.city.city));
  }

  // Stable for the memoized rows; reads the latest options and handlers.
  const latest = useRef({ options, choose });
  latest.current = { options, choose };
  const chooseIndex = useCallback((i: number) => {
    const o = latest.current.options[i];
    if (o) latest.current.choose(o);
  }, []);

  function commit() {
    remember(value);
    go(`/search?q=${encodeURIComponent(value.trim())}`);
  }

  function removeFilter(chip: FilterChip) {
    update(withoutFilter(value, chip.key, state.response.filters));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = options.length;
    const atEnd = e.currentTarget.selectionStart === value.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setFocused(true);
      if (n === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i === -1 && step === -1 ? n - 1 : (i + step + n) % n));
    } else if ((e.key === "ArrowRight" || e.key === "End") && ghost && atEnd) {
      e.preventDefault();
      update(value + ghost);
    } else if (e.key === "Enter") {
      const pick = options[active];
      if (pick) {
        e.preventDefault();
        choose(pick);
      } else if (typed) {
        // Nothing highlighted: the full results page, never a silent first pick (D-048).
        e.preventDefault();
        commit();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setActive(-1);
      if (value) update("");
      else closeSheet();
    }
  }

  const activeId = active >= 0 && options[active] ? `${listboxId}-${active}` : undefined;

  return (
    <div
      ref={wrapperRef}
      onFocus={() => setWithin(true)}
      onBlur={(e) => {
        if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return;
        setWithin(false);
        if (sheet && !sheetEntry.current) setSheet(false);
      }}
    >
      <Sheet open={sheet} onClose={closeSheet} closeLabel="Cancel" className="relative w-full">
        <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
          Search concerts, festivals, artists or cities
        </label>
        <div className="relative rounded-field bg-surface">
          <SearchIcon />
          {ghost && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-14 left-12 flex items-center overflow-hidden text-lg whitespace-pre"
            >
              <span className="invisible">{value}</span>
              <span className="text-muted">{ghost}</span>
            </span>
          )}
          <input
            ref={inputRef}
            id={SEARCH_INPUT_ID}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showResults}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-describedby={hintId}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={MAX_CHARS}
            placeholder="Search gigs, artists, cities"
            value={value}
            onChange={(e) => update(e.target.value)}
            onFocus={() => {
              setFocused(true);
              openSheet();
            }}
            onBlur={() => {
              setFocused(false);
              setRestored(false);
            }}
            onKeyDown={onKeyDown}
            className={cx(
              "relative h-16 w-full rounded-field border-2 border-night bg-transparent pr-14 pl-12 sm:pr-24 text-lg text-ink outline-none",
              "shadow-[4px_5px_0_0_var(--color-night)] transition-shadow duration-(--duration-base)",
              "placeholder:text-muted focus:shadow-[0_0_0_4px_var(--color-lime),0_0_0_6px_var(--color-night)]",
            )}
          />
          <span className="absolute inset-y-0 right-2 flex items-center gap-1">
            {state.status === "loading" && state.slow && (
              <span
                aria-hidden
                className="size-5 animate-spin rounded-full border-2 border-line border-t-violet"
              />
            )}
            {value ? (
              <button
                type="button"
                aria-label="Clear search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  update("");
                  inputRef.current?.focus();
                }}
                className="grid size-11 place-items-center rounded-full text-xl text-ink hover:bg-surface-2"
              >
                <span aria-hidden>×</span>
              </button>
            ) : (
              <kbd className="mr-2 hidden rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs font-semibold text-ink sm:inline">
                /
              </kbd>
            )}
          </span>
        </div>
        <p id={hintId} className="sr-only">
          Type at least two letters. Up and down arrows choose, Enter opens, right arrow completes.
        </p>
        <p role="status" className="sr-only">
          {statusMessage(state, typed, lookup)}
        </p>

        {showRecommendations && (
          <RecommendationsPanel
            typedOne={value.trim().length === 1}
            recent={recent}
            sections={sections}
            onQuery={(q) => {
              update(q);
              inputRef.current?.focus();
            }}
            onOpenEvent={(e) => setOpening(e)}
            dates={dateChips(new Date())}
            cities={cityChips(sections, city)}
            onClearRecent={() => {
              setRecent([]);
              writeRecent([]);
              inputRef.current?.focus();
            }}
            onGo={go}
          />
        )}

        <AnimatePresence>
          {showResults && (
            <motion.div
              key="results"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
            >
              <ResultsPanel
                listboxId={listboxId}
                state={state}
                groups={groups}
                local={local}
                active={active}
                query={value.trim()}
                onHover={setActive}
                onChoose={chooseIndex}
                onRemoveFilter={removeFilter}
                onQuery={(q) => update(q)}
                onRetry={retry}
                lookup={lookup}
                onOpenEvent={(e) => {
                  remember(value);
                  logSearchClick(value.trim(), e.id);
                  setOpening(e);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Sheet>
      {opening && <EventShell event={opening} />}
      {(showResults || showRecommendations) &&
        createPortal(
          // Dims the page behind an open panel (tablet and up) so nothing peeks through.
          <div
            aria-hidden
            onMouseDown={() => inputRef.current?.blur()}
            className="fixed inset-0 z-[15] hidden bg-bg/70 backdrop-blur-[2px] sm:block"
          />,
          document.body,
        )}
    </div>
  );
}

/** `?q=` in the URL, so Back, refresh and shared links reproduce the search (D-048 C). */
function keepQueryInUrl(raw: string) {
  const url = new URL(window.location.href);
  const q = normalizeQuery(raw);
  if ((url.searchParams.get("q") ?? "") === q) return;
  if (q.length >= MIN_CHARS) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", url);
}

function statusMessage(state: SearchState, typed: boolean, lookup: LookupView): string {
  if (!typed) return "";
  if (state.retrying) return "Search isn't responding, retrying…";
  if (state.status === "loading") return state.slow ? "Searching…" : "";
  if (state.status === "error") {
    return state.error === "offline" ? "Offline. Reconnect." : "Search is down. Retry.";
  }
  if (state.status !== "done") return "";
  const r = state.response;
  const n = r.results.length + r.artists.length + r.cities.length;
  if (n === 0 && lookup.kind === "looking") return `Looking for ${state.query}…`;
  if (n === 0 && lookup.kind === "found")
    return `Found ${lookup.results.length} for ${state.query}.`;
  if (n === 0)
    return `No ${state.query} shows yet.${r.didYouMean ? ` Did you mean ${r.didYouMean}?` : ""}`;
  return `${n} ${n === 1 ? "result" : "results"}. Use the arrow keys to choose.`;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="pointer-events-none absolute top-1/2 left-4 z-10 size-6 -translate-y-1/2 text-ink"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

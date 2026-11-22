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
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { cx } from "../ui/cx";
import { EASE_OUT_EXPO } from "../ui/motion";
import { MAX_CHARS, MIN_CHARS, normalizeQuery, type SearchState } from "./event-search";
import { EventShell } from "./EventShell";
import { liveLookup, worthLookingUp, type LookupView } from "./live-lookup";
import { cityChips, dateChips } from "./quick-chips";
import { pushRecent, readRecent, writeRecent } from "./recent-searches";
import { RUN_SEARCH_EVENT } from "./run-search";
import { RecommendationsPanel, ResultsPanel } from "./SearchPanels";
import { CLOSED, sheetReducer, type SheetEvent, type SheetState } from "./search-sheet";
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
import { fetchRecommendations, SEARCH_CAPABILITIES } from "./source";
import type { EventResult, RecommendationSection } from "./types";
import { useEventSearch } from "./useEventSearch";
import { track } from "../analytics/track";
import { useSearchOpenSignal } from "../ui/search-open";

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
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const sheetBoxRef = useRef<HTMLDivElement>(null);
  /** True while we hand focus back to the field after closing: don't reopen. */
  const restoringFocus = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fallbackTimer.current), []);
  const [value, setValue] = useState(initialQuery);
  const [focused, setFocused] = useState(false);
  const [within, setWithin] = useState(false);
  const [restored, setRestored] = useState(
    restoreResults && initialQuery.trim().length >= MIN_CHARS,
  );
  const [sheet, setSheet] = useState<SheetState>(CLOSED);
  const sheetRef = useRef(sheet);
  const sheetOpen = sheet.mode === "sheet";
  const phone = useIsPhone();
  const viewport = useVisualViewport(sheetOpen);
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
  const showResults = (focused || restored || sheetOpen) && typed && state.status !== "idle";
  // UX #11: date chips are always there, so the empty sheet is never blank.
  const showRecommendations = (within || sheetOpen) && !typed;
  // Phones only ever show panels inside the full-screen sheet, never inline (mobile P0).
  const panelsHere = sheetOpen || !phone;
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

  /** Runs the open/close logic (search-sheet.ts) and its effects, in order. */
  const dispatch = useCallback((e: SheetEvent) => {
    const { state: next, effects } = sheetReducer(sheetRef.current, e);
    sheetRef.current = next;
    // Opening the sheet renders its input now, so it can take focus within the same tap
    // (iOS only raises the keyboard for focus() inside a user gesture).
    if (next.mode === "sheet" && effects.includes("focusSheetInput"))
      flushSync(() => setSheet(next));
    else setSheet(next);
    for (const effect of effects) {
      if (effect === "pushHistory")
        window.history.pushState({ tixtapeSearch: true }, "", window.location.href);
      else if (effect === "historyBack") window.history.back();
      else if (effect === "focusSheetInput") sheetInputRef.current?.focus({ preventScroll: true });
      else if (effect === "blurTrigger") inputRef.current?.blur();
      else if (effect === "focusTrigger") {
        // Read-only until it blurs, so the returned focus doesn't raise the keyboard again.
        const el = inputRef.current;
        if (el) {
          restoringFocus.current = true;
          el.readOnly = true;
          el.focus({ preventScroll: true });
          restoringFocus.current = false;
        }
      }
    }
  }, []);

  // Phone: the device back button closes the search sheet instead of leaving the page.
  useEffect(() => {
    const onPop = () => dispatch({ type: "popstate" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dispatch]);

  // The page behind the sheet doesn't scroll.
  useEffect(() => {
    if (!sheetOpen) return;
    const { documentElement: html, body } = document;
    const before = [html.style.overflow, body.style.overflow];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = before[0]!;
      body.style.overflow = before[1]!;
    };
  }, [sheetOpen]);

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
      (sheetRef.current.mode === "sheet" ? sheetInputRef : inputRef).current?.focus();
    };
    window.addEventListener(RUN_SEARCH_EVENT, onRun);
    return () => window.removeEventListener(RUN_SEARCH_EVENT, onRun);
  }, [update]);

  // Shared signal (`<body data-search-open>`): the sticky bottom bar hides while search is open.
  useSearchOpenSignal(sheet.mode !== "closed");

  function openSheet() {
    dispatch({ type: "open", phone: window.matchMedia(PHONE).matches });
  }

  /** Focus whichever field is live: the sheet's on phones while it's open. */
  function focusField() {
    (sheetRef.current.mode === "sheet" ? sheetInputRef : inputRef).current?.focus();
  }

  /** Leaving for another page. Pushing keeps the sheet's entry, which carries `?q=` for Back. */
  function go(href: string) {
    dispatch({ type: "navigate" });
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
    } else if (
      (e.key === "ArrowRight" || e.key === "End" || (e.key === "Tab" && !e.shiftKey)) &&
      ghost &&
      atEnd
    ) {
      // QA-F-9: Tab also accepts the ghost completion (only when there is one, so Tab still
      // moves focus otherwise).
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
      // Esc clears the text first; a second Esc closes (the phone sheet too).
      if (value) update("");
      else dispatch({ type: "dismiss" });
    }
  }

  const activeId = active >= 0 && options[active] ? `${listboxId}-${active}` : undefined;

  /** The search field. Inline it's the trigger (read-only on phones); the sheet has its own. */
  const field = (inSheet: boolean) => {
    const live = inSheet === sheetOpen;
    return (
      <div
        aria-hidden={(!inSheet && sheetOpen) || undefined}
        className="relative min-w-0 flex-1 rounded-field bg-surface"
      >
        <SearchIcon />
        {ghost && live && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-14 left-12 flex items-center overflow-hidden text-lg whitespace-pre"
          >
            <span className="invisible">{value}</span>
            <span className="text-muted">{ghost}</span>
          </span>
        )}
        <input
          ref={inSheet ? sheetInputRef : inputRef}
          id={inSheet ? `${SEARCH_INPUT_ID}-sheet` : SEARCH_INPUT_ID}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={live && showResults}
          aria-controls={listboxId}
          aria-activedescendant={live ? activeId : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={MAX_CHARS}
          placeholder="Artists, gigs, cities"
          value={value}
          tabIndex={!inSheet && sheetOpen ? -1 : undefined}
          onChange={(e) => update(e.target.value)}
          onFocus={() => {
            if (!inSheet && restoringFocus.current) return;
            setFocused(true);
            if (!inSheet) openSheet();
          }}
          // Already focused (after Cancel): a tap still opens the sheet.
          onClick={!inSheet && phone ? openSheet : undefined}
          onBlur={(e) => {
            e.currentTarget.readOnly = false;
            setFocused(false);
            setRestored(false);
          }}
          onKeyDown={onKeyDown}
          className={cx(
            "relative w-full rounded-field border-2 border-night bg-transparent pr-14 pl-12 text-lg text-ink outline-none sm:pr-24",
            inSheet ? "h-12" : "h-16 shadow-[4px_5px_0_0_var(--color-night)]",
            "transition-shadow duration-(--duration-base)",
            "placeholder:text-muted focus:shadow-[0_0_0_4px_var(--color-lime),0_0_0_6px_var(--color-night)]",
          )}
        />
        <span className="absolute inset-y-0 right-2 flex items-center gap-1">
          {live && state.status === "loading" && state.slow && (
            <span
              aria-hidden
              className="size-5 animate-spin rounded-full border-2 border-line border-t-violet"
            />
          )}
          {value && (inSheet || !phone) ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                update("");
                focusField();
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
    );
  };

  const panels = (
    <>
      {showRecommendations && (
        <RecommendationsPanel
          typedOne={value.trim().length === 1}
          recent={recent}
          sections={sections}
          onQuery={(q) => {
            update(q);
            focusField();
          }}
          onOpenEvent={(e) => setOpening(e)}
          dates={dateChips(new Date())}
          cities={cityChips(sections, city)}
          onClearRecent={() => {
            setRecent([]);
            writeRecent([]);
            focusField();
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
                setOpening(e);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <div
      ref={wrapperRef}
      onFocus={() => setWithin(true)}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        // The sheet is portaled, but its React events still bubble here.
        if (wrapperRef.current?.contains(to) || sheetBoxRef.current?.contains(to)) return;
        setWithin(false);
        dispatch({ type: "blur" });
      }}
      className="relative w-full"
    >
      <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
        Search concerts, festivals, artists or cities
      </label>
      {field(false)}
      <p id={hintId} className="sr-only">
        Type at least two letters. Up and down arrows choose, Enter opens, Tab or right arrow
        completes.
      </p>
      <p role="status" className="sr-only">
        {statusMessage(state, typed, lookup)}
      </p>
      {!sheetOpen && panelsHere && panels}

      {sheetOpen &&
        createPortal(
          // Mobile P0: a full-screen sheet above everything, sized to the visual viewport so the
          // iOS keyboard never covers the field or the results.
          <div
            ref={sheetBoxRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="fixed inset-x-0 top-0 z-[60] flex h-dvh flex-col bg-bg text-ink"
            style={viewport ? { top: viewport.top, height: viewport.height } : undefined}
          >
            <div className="flex items-center gap-2 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] pb-2 pl-[max(1rem,env(safe-area-inset-left))]">
              <label htmlFor={`${SEARCH_INPUT_ID}-sheet`} className="sr-only">
                Search concerts, festivals, artists or cities
              </label>
              {field(true)}
              <button
                type="button"
                onClick={() => dispatch({ type: "dismiss" })}
                className="min-h-11 shrink-0 rounded-chip px-3 text-sm font-semibold text-ink hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {panels}
            </div>
          </div>,
          document.body,
        )}
      {opening && <EventShell event={opening} />}
      {!phone &&
        (showResults || showRecommendations) &&
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

const subscribePhone = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/** ≤ 639 px wide. False during server render (the inline field renders the same either way). */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

/** The visible area above the on-screen keyboard, while `active`. Null: use 100dvh. */
function useVisualViewport(active: boolean): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = active ? window.visualViewport : null;
    if (!vv) {
      setBox(null);
      return;
    }
    const sync = () => setBox({ top: vv.offsetTop, height: vv.height });
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [active]);
  return box;
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

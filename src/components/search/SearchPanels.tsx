"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { formatDateRange } from "../event-format";
import { ChipButton } from "../ui/Chip";
import { cx } from "../ui/cx";
import type { SearchState } from "./event-search";
import type { LookupView } from "./live-lookup";
import { filterChips, type FilterChip, type OptionGroup } from "./search-view";
import { SearchRow } from "./SearchRows";
import type { EventResult, RecommendationSection } from "./types";

/** Keeps focus in the search box while a button inside the panel is pressed. */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

type RecProps = {
  typedOne: boolean;
  recent: string[];
  sections: RecommendationSection[];
  onQuery: (q: string) => void;
  onOpenEvent: (e: EventResult) => void;
};

/** A. Before typing: recent searches and recommendation sections (not a listbox: plain links). */
export function RecommendationsPanel({
  typedOne,
  recent,
  sections,
  onQuery,
  onOpenEvent,
}: RecProps) {
  return (
    <div className="z-30 mt-3 max-h-[70dvh] space-y-5 overflow-y-auto rounded-card border-2 border-night bg-surface p-4 text-ink shadow-[4px_6px_0_0_var(--color-night)] sm:absolute sm:inset-x-0 sm:top-full max-sm:max-h-none">
      {typedOne && <p className="text-sm font-semibold text-muted">Keep typing…</p>}
      {recent.length > 0 && (
        <Block title="Recent searches">
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <ChipButton key={r} onMouseDown={keepFocus} onClick={() => onQuery(r)}>
                <span aria-hidden>🕘</span> {r}
              </ChipButton>
            ))}
          </div>
        </Block>
      )}
      {sections.map((s) => (
        <Block key={s.id} title={s.title}>
          {s.queries && s.queries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {s.queries.map((q) => (
                <ChipButton key={q} onMouseDown={keepFocus} onClick={() => onQuery(q)}>
                  <span aria-hidden>🔥</span> {q}
                </ChipButton>
              ))}
            </div>
          )}
          {s.items && s.items.length > 0 && (
            <EventLinks events={s.items} onOpenEvent={onOpenEvent} />
          )}
        </Block>
      ))}
    </div>
  );
}

function EventLinks({
  events,
  onOpenEvent,
}: {
  events: EventResult[];
  onOpenEvent: (e: EventResult) => void;
}) {
  return (
    <ul className="space-y-1">
      {events.map((e) => (
        <li key={e.id}>
          <Link
            href={`/events/${e.id}`}
            onMouseDown={keepFocus}
            onClick={() => onOpenEvent(e)}
            className="flex min-h-12 items-center gap-3 rounded-field px-2 py-1.5 hover:bg-surface-2"
          >
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2"
            >
              {e.type === "festival" ? "🎪" : "🎟️"}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{e.title}</span>
              <span className="block truncate text-sm text-muted">
                {[e.city, formatDateRange(new Date(e.startsAt), null)].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function LookupBlock({
  lookup,
  onOpenEvent,
  onPick,
}: {
  lookup: LookupView;
  onPick: (name: string) => void;
  onOpenEvent: (e: EventResult) => void;
}) {
  if (lookup.kind === "looking") {
    return (
      <p className="flex items-center gap-3 px-4 pt-4 font-semibold">
        {lookup.artist?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN image, small and decorative
          <img
            src={lookup.artist.imageUrl}
            alt=""
            className="size-12 shrink-0 rounded-full object-cover motion-safe:animate-pulse"
          />
        ) : (
          <span aria-hidden className="inline-block motion-safe:animate-bounce">
            🔎
          </span>
        )}
        {lookup.artist ? `Looking for ${lookup.artist.name}…` : `Looking for ‘${lookup.query}’…`}
      </p>
    );
  }
  if (lookup.kind === "found") {
    return (
      <div className="px-4 pt-4">
        <p className="font-display text-xl font-extrabold">Found it 🎉</p>
        <div className="mt-2">
          <EventLinks events={lookup.results} onOpenEvent={onOpenEvent} />
        </div>
      </div>
    );
  }
  if (lookup.kind === "not_found" && lookup.candidates.length > 0) {
    return (
      <div className="px-4 pt-4">
        <p className="font-display text-xl font-extrabold">Did you mean…</p>
        <ul className="mt-2 space-y-1">
          {lookup.candidates.map((a) => (
            <li key={a.spotifyId ?? a.name}>
              <button
                type="button"
                onMouseDown={keepFocus}
                onClick={() => onPick(a.name)}
                className="flex min-h-12 w-full items-center gap-3 rounded-field px-2 py-1.5 text-left font-semibold hover:bg-surface-2"
              >
                {a.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN image, small and decorative
                  <img
                    src={a.imageUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2"
                  >
                    🎤
                  </span>
                )}
                {a.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (lookup.kind === "not_found") {
    const name = lookup.artist?.name ?? lookup.query;
    return (
      <div className="flex items-center gap-3 px-4 pt-4">
        {lookup.artist?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN image, small and decorative
          <img
            src={lookup.artist.imageUrl}
            alt=""
            className="size-14 shrink-0 rounded-full object-cover"
          />
        )}
        <p className="font-semibold">{name}: no India dates yet</p>
      </div>
    );
  }
  return null;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <p aria-hidden className="mb-2 text-xs font-bold tracking-wider text-muted uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

type ResultsProps = {
  listboxId: string;
  state: SearchState;
  groups: OptionGroup[];
  /** True while showing instant local matches before the server answers. */
  local: boolean;
  active: number;
  query: string;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
  onRemoveFilter: (chip: FilterChip) => void;
  onQuery: (q: string) => void;
  onRetry: () => void;
  onOpenEvent: (e: EventResult) => void;
  lookup: LookupView;
};

/** B. While typing: filter chips, grouped options, and the no-match / error states. */
export function ResultsPanel(p: ResultsProps) {
  const { state, groups } = p;
  const chips = filterChips(state.response.filters);
  const empty = state.status === "done" && groups.length === 0;
  let index = 0;
  return (
    <div
      aria-busy={state.status === "loading"}
      className="z-30 mt-3 overflow-hidden rounded-card border-2 border-night bg-surface text-left text-ink shadow-[4px_6px_0_0_var(--color-night)] sm:absolute sm:inset-x-0 sm:top-full"
    >
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          {chips.map((c) => (
            <ChipButton
              key={c.key}
              onMouseDown={keepFocus}
              onClick={() => p.onRemoveFilter(c)}
              aria-label={`Remove filter ${c.label}`}
            >
              <span aria-hidden>{c.emoji}</span> {c.label} <span aria-hidden>×</span>
            </ChipButton>
          ))}
        </div>
      )}
      {empty && p.lookup.kind !== "idle" && (
        <LookupBlock lookup={p.lookup} onOpenEvent={p.onOpenEvent} onPick={p.onQuery} />
      )}
      {empty && p.lookup.kind === "idle" && (
        <div className="px-4 pt-4">
          <p className="font-display text-xl font-extrabold">No {state.query} shows yet</p>
          <p className="mt-1 text-sm text-muted">Try an artist or city</p>
          {state.response.fallback.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-bold tracking-wider text-muted uppercase">
                Try these instead
              </p>
              <EventLinks events={state.response.fallback} onOpenEvent={p.onOpenEvent} />
            </div>
          )}
          {state.response.didYouMean && (
            <ChipButton
              className="mt-3"
              onMouseDown={keepFocus}
              onClick={() => p.onQuery(state.response.didYouMean!)}
            >
              Did you mean <strong>{state.response.didYouMean}</strong>?
            </ChipButton>
          )}
        </div>
      )}
      <ul
        id={p.listboxId}
        role="listbox"
        aria-label="Search suggestions"
        className={cx(
          "max-h-[min(28rem,60dvh)] overflow-y-auto py-2 transition-opacity max-sm:max-h-none",
          (state.stale || p.local) && "opacity-60",
        )}
      >
        {groups.map((g) => (
          <li key={g.id} role="presentation">
            <ul role="group" aria-labelledby={`${p.listboxId}-${g.id}`}>
              <li
                role="presentation"
                id={`${p.listboxId}-${g.id}`}
                className="px-4 pt-2 pb-1 text-xs font-bold tracking-wider text-muted uppercase"
              >
                {g.label}
              </li>
              {g.options.map((o) => {
                const i = index++;
                return (
                  <SearchRow
                    key={o.key}
                    id={`${p.listboxId}-${i}`}
                    option={o}
                    query={p.query}
                    index={i}
                    active={i === p.active}
                    onHover={p.onHover}
                    onChoose={p.onChoose}
                  />
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {state.status === "done" && groups.length > 0 && <SeeAllLink query={state.query} />}
      <PanelFooter state={p.state} onRetry={p.onRetry} />
    </div>
  );
}

function PanelFooter({ state, onRetry }: { state: SearchState; onRetry: () => void }) {
  if (state.retrying) {
    return <p className="px-4 pb-4 text-sm">😵 Search down, retrying…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 pb-4 text-sm">
        <p>
          {state.error === "offline"
            ? "📡 You're offline. Reconnect and try again."
            : "😵 Search down"}
        </p>
        <ChipButton onMouseDown={keepFocus} onClick={onRetry}>
          Retry
        </ChipButton>
      </div>
    );
  }
  return (
    <p className="hidden border-t border-line px-4 py-2 text-xs text-muted sm:block">
      ↑↓ to move · Enter to open · → to complete · Esc to clear
    </p>
  );
}

/** "See all results" → /search?q=, prefetched on hover so the page is ready on click. */
export function SeeAllLink({ query }: { query: string }) {
  const router = useRouter();
  const href = `/search?q=${encodeURIComponent(query)}`;
  return (
    <Link
      href={href}
      onMouseDown={keepFocus}
      onMouseEnter={() => router.prefetch(href)}
      className="flex min-h-11 items-center justify-between border-t border-line px-4 text-sm font-semibold hover:bg-surface-2"
    >
      See all results for ‘{query}’ <span aria-hidden>→</span>
    </Link>
  );
}

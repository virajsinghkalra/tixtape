"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { eventTone } from "../event-color";
import { cx } from "../ui/cx";
import { Skeleton } from "../ui/Skeleton";
import { TONE_CLASS } from "../ui/tone";
import {
  canPrefetch,
  eventIdFromHref,
  isNewPage,
  isPlainClick,
  shellTitle,
  type ConnectionInfo,
} from "./nav-intent";

/** Only show the shell if the page isn't there yet: a prefetched page swaps in with no flash. */
const SHOW_AFTER_MS = 120;
const SLOW_AFTER_MS = 8000;
/** A hover this long is intent, not a cursor passing over the feed. */
const HOVER_DWELL_MS = 90;
/** Re-prefetching sooner than Next's own cache (5 min for full prefetches) is wasted. */
const PREFETCH_TTL_MS = 4 * 60_000;
/** `PrefetchKind.FULL`: the whole page, since event pages have no loading.tsx (QA-UI-1). */
const FULL = { kind: "full" } as unknown as PrefetchOptions;
type PrefetchOptions = NonNullable<Parameters<ReturnType<typeof useRouter>["prefetch"]>[1]>;

type Pending = { id: string; href: string; title: string };

/**
 * D-084 (UX plan #3): instant feedback for every event link on the site, with no change to the
 * cards themselves.
 *
 * - **Shell:** a plain click on an event link shows the event's colour block, its title and
 *   skeletons within ~1 frame of the delay, until the new route commits. The server still
 *   answers unknown ids with a real 404 (QA-UI-1), because nothing streams early.
 * - **Intent prefetch:** hover (after a short dwell), touchstart or keyboard focus on an event
 *   link prefetches the full page, so most taps land on a ready page. Not on Save-Data or 2G.
 *   No viewport prefetch: it would render (and count, D-081) pages nobody opens.
 */
export function NavShell() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<Pending | null>(null);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  const shown = useRef(false);

  // The route committed (or Back was pressed): drop the shell and move focus to the new title.
  useEffect(() => {
    setPending(null);
    setVisible(false);
    setSlow(false);
    if (!shown.current) return;
    shown.current = false;
    const h1 = document.querySelector<HTMLElement>("main h1");
    if (h1) {
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
    }
  }, [pathname]);

  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => {
      shown.current = true;
      setVisible(true);
    }, SHOW_AFTER_MS);
    const late = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const cancel = () => setPending(null);
    // Back/forward is a traversal: never cover it with a shell (bfcache restores instantly).
    window.addEventListener("popstate", cancel);
    return () => {
      clearTimeout(show);
      clearTimeout(late);
      window.removeEventListener("popstate", cancel);
    };
  }, [pending]);

  useEffect(() => {
    const prefetched = new Map<string, number>();
    let dwell: ReturnType<typeof setTimeout> | undefined;

    const eventLink = (target: EventTarget | null) => {
      const a = target instanceof Element ? target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return null;
      const id = eventIdFromHref(a.href, location.origin);
      return id ? { a, id } : null;
    };
    const prefetch = (href: string) => {
      const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection;
      if (!canPrefetch(connection)) return;
      const path = new URL(href).pathname;
      const last = prefetched.get(path);
      if (last && Date.now() - last < PREFETCH_TTL_MS) return;
      prefetched.set(path, Date.now());
      router.prefetch(path, FULL);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const link = eventLink(e.target);
      clearTimeout(dwell);
      if (link) dwell = setTimeout(() => prefetch(link.a.href), HOVER_DWELL_MS);
    };
    const onIntent = (e: Event) => {
      const link = eventLink(e.target);
      if (link) prefetch(link.a.href);
    };
    const onClick = (e: MouseEvent) => {
      const link = eventLink(e.target);
      if (!link) return;
      const plain = isPlainClick({
        button: e.button,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        target: link.a.getAttribute("target"),
        download: link.a.hasAttribute("download"),
      });
      if (!plain || !isNewPage(link.a.href, location)) return;
      const heading = link.a.querySelector("h1, h2, h3")?.textContent;
      setPending({
        id: link.id,
        href: link.a.href,
        title: shellTitle(heading, link.a.getAttribute("aria-label") ?? link.a.textContent),
      });
    };

    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("touchstart", onIntent, { passive: true, capture: true });
    document.addEventListener("focusin", onIntent);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      clearTimeout(dwell);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("touchstart", onIntent, { capture: true });
      document.removeEventListener("focusin", onIntent);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [router]);

  if (!pending || !visible) return null;
  return (
    <div
      aria-busy="true"
      data-testid="nav-shell"
      className="fixed inset-x-0 top-16 bottom-0 z-[60] overflow-y-auto bg-bg px-4 pt-4 sm:px-6"
    >
      <p role="status" className="sr-only">
        {slow ? "Still loading" : `Opening ${pending.title || "event"}…`}
      </p>
      <div className="mx-auto max-w-6xl">
        <div aria-hidden className="h-11" />
        <div
          aria-hidden
          className={cx(
            "fade-in mt-3 rounded-tile border-2 border-night p-5 sm:p-7",
            TONE_CLASS[eventTone(pending.id)],
          )}
        >
          <Skeleton className="h-6 w-32 rounded-chip opacity-60" />
          <p className="mt-5 font-display text-huge font-extrabold tracking-tight text-balance">
            {pending.title}
          </p>
          <Skeleton className="mt-5 h-5 w-48 opacity-60" />
        </div>
        {slow ? (
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <p className="font-display text-2xl font-extrabold">Still loading…</p>
            <button
              type="button"
              onClick={() => window.location.assign(pending.href)}
              className="min-h-11 rounded-chip bg-lime px-5 font-semibold text-on-block active:scale-[0.96]"
            >
              Retry
            </button>
          </div>
        ) : (
          <div aria-hidden className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <Skeleton className="h-96" />
            <Skeleton className="h-72" />
          </div>
        )}
      </div>
    </div>
  );
}

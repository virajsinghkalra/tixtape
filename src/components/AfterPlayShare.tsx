"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import {
  parseSeen,
  PLAYED_EVENT,
  SHARE_SEEN_KEY,
  sharePageUrl,
  shouldOfferShare,
  whatsAppUrl,
  withSeen,
  type Played,
} from "./after-play";
import { track } from "./analytics/track";
import { shareCopy, VIBES, type Vibe } from "./vibe-copy";
import { buttonClass } from "./ui/Button";
import { copyText } from "./ui/copy-text";
import { cx } from "./ui/cx";
import { haptic } from "./ui/feedback";
import { SPRING } from "./ui/motion";
import { useToast } from "./ui/Toast";

const VISIT_KEY = "tixtape.aftershare.visit";

function readSeen(): string[] {
  try {
    return parseSeen(localStorage.getItem(SHARE_SEEN_KEY));
  } catch {
    return [];
  }
}

function markShown(eventId: string): void {
  try {
    localStorage.setItem(SHARE_SEEN_KEY, JSON.stringify(withSeen(readSeen(), eventId)));
    sessionStorage.setItem(VISIT_KEY, "1");
  } catch {
    // Blocked storage: it may ask again next time, which is fine.
  }
}

function shownThisVisit(): boolean {
  try {
    return sessionStorage.getItem(VISIT_KEY) === "1";
  } catch {
    return true; // can't remember, so don't risk nagging
  }
}

/** Mounted once in the layout: after a play, when the visitor comes back, "send it to the gang". */
export function AfterPlayShare() {
  const [shown, setShown] = useState<{ id: string; vibe: Vibe } | null>(null);
  const pending = useRef<{ id: string; vibe: Vibe; at: number } | null>(null);

  useEffect(() => {
    const onPlayed = (e: Event) => {
      const { eventId, vibe } = (e as CustomEvent<Played>).detail;
      const known = VIBES.find((v) => v === vibe) ?? "default";
      pending.current = { id: eventId, vibe: known, at: Date.now() };
    };
    const onVisible = () => {
      const p = pending.current;
      if (document.visibilityState !== "visible" || !p) return;
      pending.current = null;
      const ok = shouldOfferShare({
        seen: readSeen(),
        eventId: p.id,
        shownThisVisit: shownThisVisit(),
        awayMs: Date.now() - p.at,
        otherSheetOpen: Boolean(document.querySelector('[data-testid="identity-sheet"]')),
      });
      if (!ok) return;
      markShown(p.id);
      setShown({ id: p.id, vibe: p.vibe });
    };
    window.addEventListener(PLAYED_EVENT, onPlayed);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(PLAYED_EVENT, onPlayed);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <AnimatePresence>
      {shown && (
        <ShareCard
          key={shown.id}
          eventId={shown.id}
          vibe={shown.vibe}
          onClose={() => setShown(null)}
        />
      )}
    </AnimatePresence>
  );
}

function ShareCard({
  eventId,
  vibe,
  onClose,
}: {
  eventId: string;
  vibe: Vibe;
  onClose: () => void;
}) {
  const copy = shareCopy(vibe, eventId);
  const titleId = useId();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const origin = window.location.origin;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onWhatsApp() {
    track("share", { channel: "whatsapp", eventId });
    haptic("success");
    onClose();
  }

  async function onMore() {
    const channel = "share" in navigator ? "native" : "copy";
    const url = sharePageUrl(origin, eventId, channel);
    track("share", { channel, eventId });
    try {
      if (navigator.share) {
        await navigator.share({ text: copy.text, url });
        haptic("success");
      } else {
        haptic("success");
        toast.show("Link copied 🔗");
        if (!(await copyText(url))) toast.show("Couldn't copy. Use the URL.", "error");
      }
      onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast.show("Couldn't share. Copy the URL.", "error");
    }
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="after-play-share"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
      transition={reduceMotion ? { duration: 0.15 } : SPRING}
      className={cx(
        "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[65] mx-auto max-w-md",
        "rounded-card border-2 border-night bg-surface p-4 shadow-[4px_5px_0_0_var(--color-night)]",
        "dark:border-line dark:shadow-[4px_5px_0_0_var(--color-violet)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="font-display text-lg font-extrabold">
          {copy.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="-mt-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-surface-2"
          aria-label="Not now"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <a
          href={whatsAppUrl(copy.text, sharePageUrl(origin, eventId, "wa"))}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onWhatsApp}
          className={buttonClass("primary", "md", "flex-1")}
        >
          <span aria-hidden>💬</span> WhatsApp
        </a>
        <button type="button" onClick={onMore} className={buttonClass("secondary", "md")}>
          <span aria-hidden>↗</span> More
        </button>
      </div>
    </motion.div>
  );
}

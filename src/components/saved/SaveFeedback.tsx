"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { RemindMe } from "../RemindMe";
import { SPRING_SOFT } from "../ui/motion";
import { SAVE_COPY } from "./save-copy";

const VISIBLE_MS = 6000;

/**
 * D-092: what a save says back: "Saved to Your gigs ♡ · View", plus a one-tap "🔔 Remind me"
 * when the event's calendar links are known. Not modal; closes itself after a few seconds.
 */
export function SaveFeedback({
  eventId,
  remind,
  onClose,
}: {
  eventId: string;
  remind?: { icsHref: string; googleHref: string };
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(onClose, VISIBLE_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      role="status"
      data-testid="save-feedback"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={reduceMotion ? { duration: 0.12 } : SPRING_SOFT}
      className="fixed inset-x-3 bottom-24 z-[66] mx-auto flex max-w-md flex-wrap items-center gap-2 rounded-card border-2 border-night bg-lime p-2 pl-4 text-on-block shadow-[3px_4px_0_0_var(--color-night)] sm:bottom-6"
    >
      <p className="min-w-0 flex-1 font-semibold">
        {SAVE_COPY.savedTo}
        {" · "}
        <Link href="/me/gigs" className="underline underline-offset-4" onClick={onClose}>
          {SAVE_COPY.view}
        </Link>
      </p>
      {remind && (
        <RemindMe
          eventId={eventId}
          icsHref={remind.icsHref}
          googleHref={remind.googleHref}
          variant="night"
          menuUp
        />
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={SAVE_COPY.dismiss}
        className="grid size-11 shrink-0 place-items-center rounded-full text-xl hover:bg-night/10"
      >
        <span aria-hidden>×</span>
      </button>
    </motion.div>,
    document.body,
  );
}

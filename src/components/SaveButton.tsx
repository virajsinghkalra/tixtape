"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import type { SavedShow } from "./device/device-lists";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { SaveFeedback } from "./saved/SaveFeedback";
import { useSaveToggle } from "./saved/useSaveToggle";
import { COPY } from "./ux-copy";

type Props = {
  show: Omit<SavedShow, "savedAt">;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** D-092: the event's calendar links, for the one-tap "Remind me" after saving. */
  remind?: { icsHref: string; googleHref: string };
};

/**
 * "♡ Save" / "♥ Saved" (UX #12, D-088): kept on this device, shown in "Your gigs". D-092: a save
 * says so ("Saved to Your gigs ♡ · View" + Remind me), an unsave says "Removed", and both sync
 * to the server for a person who opted in with an email.
 */
export function SaveButton({ show, variant = "secondary", size = "md", remind }: Props) {
  const reduceMotion = useReducedMotion();
  const [feedback, setFeedback] = useState(false);
  const close = useCallback(() => setFeedback(false), []);
  const onSaved = useCallback(() => setFeedback(true), []);
  const { on, toggle } = useSaveToggle(show, { onSaved, onRemoved: close });

  return (
    <>
      <AnimatePresence>
        {feedback && <SaveFeedback eventId={show.id} remind={remind} onClose={close} />}
      </AnimatePresence>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={`${on ? COPY.saved : COPY.save} ${show.title}`}
        className={buttonClass(variant, size)}
      >
        <motion.span
          aria-hidden
          key={String(on)}
          initial={reduceMotion || !on ? false : { scale: 1 }}
          animate={reduceMotion || !on ? undefined : { scale: [1, 1.25, 1] }}
          // Three keyframes can't use a spring (motion throws and the tree crashes): a short tween.
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={on ? "text-pink" : undefined}
        >
          {on ? "♥" : "♡"}
        </motion.span>
        {on ? COPY.saved : COPY.save}
      </button>
    </>
  );
}

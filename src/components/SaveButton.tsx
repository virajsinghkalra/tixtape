"use client";

import { motion, useReducedMotion } from "motion/react";
import { track } from "./analytics/track";
import { SAVED, type SavedShow } from "./device/device-lists";
import { useDeviceList } from "./device/use-device-list";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { haptic } from "./ui/feedback";
import { SPRING } from "./ui/motion";
import { COPY } from "./ux-copy";

type Props = {
  show: Omit<SavedShow, "savedAt">;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/** "♡ Save" / "♥ Saved" (UX #12, D-088): kept on this device, shown in "Your gigs" on home. */
export function SaveButton({ show, variant = "secondary", size = "md" }: Props) {
  const saved = useDeviceList(SAVED);
  const on = saved.ready && saved.has(show.id);
  const reduceMotion = useReducedMotion();

  function toggle() {
    if (on) saved.remove(show.id);
    else {
      saved.add({ ...show, savedAt: new Date().toISOString() });
      track("save", { eventId: show.id });
    }
    haptic("tap");
  }

  return (
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
        transition={SPRING}
        className={on ? "text-pink" : undefined}
      >
        {on ? "♥" : "♡"}
      </motion.span>
      {on ? COPY.saved : COPY.save}
    </button>
  );
}

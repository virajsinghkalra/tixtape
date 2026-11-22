"use client";

import { motion, useReducedMotion } from "motion/react";
import type { SavedShow } from "./device/device-lists";
import { useSaveToggle } from "./saved/useSaveToggle";
import { cx } from "./ui/cx";
import { COPY } from "./ux-copy";

type Props = {
  show: Omit<SavedShow, "savedAt">;
  className?: string;
};

/** Icon-only ♡ → ♥ save, same behaviour as the event page's Save (useSaveToggle). 44×44. */
export function HeartButton({ show, className }: Props) {
  const reduceMotion = useReducedMotion();
  const { on, toggle } = useSaveToggle(show, { toastOnSave: true });

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={`${on ? COPY.saved : COPY.save} ${show.title}`}
      className={cx(
        "inline-flex size-11 items-center justify-center rounded-chip border-2 border-night bg-surface text-xl leading-none text-ink",
        "shadow-[2px_3px_0_0_var(--color-night)] transition-transform duration-(--duration-fast) ease-spring active:scale-95",
        className,
      )}
    >
      <motion.span
        aria-hidden
        key={String(on)}
        initial={false}
        animate={reduceMotion || !on ? undefined : { scale: [1, 1.35, 1] }}
        // Three keyframes can't use a spring (motion throws): a short tween.
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={on ? "text-pink" : undefined}
      >
        {on ? "♥" : "♡"}
      </motion.span>
    </button>
  );
}

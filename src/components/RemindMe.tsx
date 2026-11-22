"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { track } from "./analytics/track";
import { REMINDED } from "./device/device-lists";
import { useDeviceList } from "./device/use-device-list";
import { currentPlatform, remindRoute } from "./platform";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { haptic } from "./ui/feedback";
import { SPRING } from "./ui/motion";
import { useToast } from "./ui/Toast";
import { COPY } from "./ux-copy";

type Props = {
  eventId: string;
  /** `/api/events/:id/calendar.ics`. */
  icsHref: string;
  googleHref: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Open the desktop menu upwards (inside a card pinned to the bottom, D-092). */
  menuUp?: boolean;
};

/**
 * "Remind me 🔔" (UX #2, D-088). A plain link to the .ics, upgraded by script to the platform's
 * best route: iOS Safari → .ics (native "Add event"), Android and in-app browsers → Google
 * Calendar, desktop → a small menu with both. We can't see whether the visitor saved it, so
 * the toast hedges and the label (kept on this device) just says "Reminded".
 */
export function RemindMe({
  eventId,
  icsHref,
  googleHref,
  variant = "secondary",
  size = "md",
  menuUp = false,
}: Props) {
  const reminded = useDeviceList(REMINDED);
  const done = reminded.ready && reminded.has(eventId);
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLAnchorElement>(null);

  function mark() {
    reminded.add(eventId);
    track("remind", { eventId });
    haptic("success");
    toast.show(COPY.remindAdded);
  }

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    const route = remindRoute(currentPlatform());
    if (route === "ics") {
      mark(); // the link itself downloads the .ics
      return;
    }
    e.preventDefault();
    if (route === "google") {
      const opened = window.open(googleHref, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = googleHref;
      mark();
      return;
    }
    setMenu((open) => !open);
  }

  const label = done ? COPY.reminded : COPY.remind;
  return (
    <span className="relative inline-flex">
      <a
        ref={trigger}
        href={icsHref}
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={menu}
        aria-controls={menu ? menuId : undefined}
        className={buttonClass(variant, size)}
      >
        <span aria-hidden>🔔</span>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={label}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={reduceMotion ? { duration: 0.12 } : SPRING}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </a>
      {menu && (
        <CalendarMenu
          id={menuId}
          icsHref={icsHref}
          googleHref={googleHref}
          up={menuUp}
          onPick={() => {
            setMenu(false);
            mark();
          }}
          onClose={() => {
            setMenu(false);
            trigger.current?.focus();
          }}
        />
      )}
    </span>
  );
}

/** Desktop: both calendars. A dialog with Esc, outside-click close and focus returned. */
function CalendarMenu({
  id,
  icsHref,
  googleHref,
  up,
  onPick,
  onClose,
}: {
  id: string;
  icsHref: string;
  googleHref: string;
  up: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !box.current?.parentElement?.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const item =
    "flex min-h-11 items-center gap-2 rounded-field px-3 font-semibold text-ink hover:bg-surface-2 focus-visible:bg-surface-2";
  return (
    <div
      ref={box}
      id={id}
      role="dialog"
      aria-label="Add to calendar"
      className={`pop-in absolute left-0 z-40 w-56 ${up ? "bottom-full mb-2" : "top-full mt-2"} rounded-card border-2 border-night bg-surface p-2 shadow-[4px_5px_0_0_var(--color-night)]`}
    >
      <a href={icsHref} onClick={onPick} className={item}>
        <span aria-hidden>🍎</span> {COPY.calendarApple}
      </a>
      <a
        href={googleHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onPick}
        className={item}
      >
        <span aria-hidden>📅</span> {COPY.calendarGoogle}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

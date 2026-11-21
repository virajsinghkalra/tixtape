"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cx } from "./ui/cx";
import { SPRING } from "./ui/motion";

const YEAR_S = 365 * 24 * 60 * 60;

/** Big Indian gig cities, always offered; cities with upcoming events are added to these. */
export const MAJOR_CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Pune",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Goa",
];

type Props = {
  /** The visitor's city (D-050), or null for "All India". */
  city: string | null;
  cities: string[];
};

/**
 * "📍 Mumbai ▾" (or "📍 All India ▾"). Choosing a city stores it in the `city` cookie for a year
 * and refreshes the page's sections. Never asks for browser geolocation (D-050).
 */
export function CitySwitcher({ city, cities }: Props) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const options = [...new Set([...cities, ...MAJOR_CITIES])].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(next: string | null) {
    document.cookie = next
      ? `city=${encodeURIComponent(next)}; Max-Age=${YEAR_S}; Path=/; SameSite=Lax`
      : "city=; Max-Age=0; Path=/; SameSite=Lax";
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div
      ref={rootRef}
      className="relative z-30"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`City: ${city ?? "All India"}. Change city`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-chip border-2 border-night bg-surface px-4 text-sm font-bold text-ink shadow-[2px_3px_0_0_var(--color-night)] transition-transform duration-(--duration-fast) ease-spring active:scale-95"
      >
        <span aria-hidden>📍</span>
        {city ?? "All India"}
        <span aria-hidden className={cx("transition-transform", open && "rotate-180")}>
          ▾
        </span>
        {pending && <span className="sr-only">Updating…</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={menuId}
            aria-label="Choose your city"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
            className="absolute top-full left-0 mt-2 grid w-64 grid-cols-2 gap-1 rounded-card border-2 border-night bg-surface p-2 text-ink shadow-[4px_6px_0_0_var(--color-night)]"
          >
            <li className="col-span-2">
              <CityOption label="All India" selected={city === null} onClick={() => choose(null)} />
            </li>
            {options.map((c) => (
              <li key={c}>
                <CityOption label={c} selected={c === city} onClick={() => choose(c)} />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function CityOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "flex min-h-11 w-full items-center rounded-field px-3 text-left text-sm font-semibold",
        selected ? "bg-lime text-on-block" : "hover:bg-surface-2",
      )}
    >
      {label}
    </button>
  );
}

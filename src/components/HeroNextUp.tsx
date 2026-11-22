"use client";

import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { countdownLabel } from "./hero-copy";
import { cx } from "./ui/cx";
import { Sticker } from "./ui/Sticker";

export type NextUpItem = {
  id: string;
  /** Already short: "Shreya Ghoshal · Bengaluru". */
  title: string;
  poster: string | null;
  artists: VisualArtist[];
  label: string;
  startsAt: string;
  endsAt: string | null;
  dateOnly: boolean;
  /** UX #6: "🎧 Live" / "⏳ Cooking", or null. */
  badge: string | null;
};

const ADVANCE_MS = 5000;
const TICK_MS = 60_000;
const SWIPE_PX = 40;

/**
 * The hero's "Next up" tile: the next 3 shows as a picture-led carousel with a live countdown.
 * Auto-advances every 5 s (paused on hover or focus, off under reduced motion); swipe or the
 * dots switch; a tap opens the event. Images are lazy, so nothing blocks first paint.
 */
export function HeroNextUp({ items, now }: { items: NextUpItem[]; now: string }) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [clock, setClock] = useState(() => new Date(now));
  const [held, setHeld] = useState(false);
  const swipe = useRef<{ x: number; moved: boolean } | null>(null);
  const count = items.length;
  const item = items[index % count]!;

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (reduceMotion || held || count < 2) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), ADVANCE_MS);
    return () => clearTimeout(id);
  }, [index, reduceMotion, held, count]);

  const label = countdownLabel(
    new Date(item.startsAt),
    item.endsAt ? new Date(item.endsAt) : null,
    clock,
    item.dateOnly,
  );
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  // MotionConfig: transforms are skipped under reduced motion, and server and client render the
  // same first frame (no reduced-motion branches in `initial`, so no hydration mismatch).
  return (
    <MotionConfig reducedMotion="user">
      <div
        className="pop-in relative isolate flex min-h-64 flex-col overflow-hidden rounded-tile border-2 border-night bg-violet text-white shadow-[5px_6px_0_0_var(--color-night)] [--i:1] dark:border-line lg:min-h-0"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        onPointerDown={(e) => (swipe.current = { x: e.clientX, moved: false })}
        onPointerUp={(e) => {
          const s = swipe.current;
          if (s && Math.abs(e.clientX - s.x) > SWIPE_PX && count > 1) {
            s.moved = true;
            go(e.clientX < s.x ? 1 : -1);
          }
        }}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={item.id}
            className="absolute inset-0 -z-10"
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <EventVisual poster={item.poster} artists={item.artists} label={item.label} />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.92),rgb(11_11_15/0.35)_55%,rgb(11_11_15/0.15))]" />
          </motion.div>
        </AnimatePresence>

        <Link
          href={`/events/${item.id}`}
          draggable={false}
          onClick={(e) => {
            if (swipe.current?.moved) e.preventDefault();
            swipe.current = null;
          }}
          className="flex flex-1 flex-col justify-between gap-6 p-5 pb-2 outline-offset-[-6px] focus-visible:outline-white sm:p-6 sm:pb-2"
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <Sticker tone="night" tilt={-3} className="gap-2">
              <EqBars still={Boolean(reduceMotion)} /> Next up
            </Sticker>
            <motion.span
              key={label}
              initial={{ scale: 0.6, rotate: -8 }}
              animate={{ scale: 1, rotate: 3 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
            >
              <Sticker tone="lime" size="md">
                <span className="tabular-nums">{label}</span>
              </Sticker>
            </motion.span>
          </span>
          <span className="flex flex-col items-start gap-2">
            {item.badge && (
              <Sticker tone={item.badge === "🎧 Live" ? "lime" : "surface"} tilt={4}>
                {item.badge}
              </Sticker>
            )}
            <span className="block font-display text-2xl leading-tight font-extrabold text-balance [overflow-wrap:anywhere] sm:text-3xl">
              {item.title} <span aria-hidden>→</span>
            </span>
          </span>
        </Link>

        {count > 1 && (
          <div className="flex justify-end px-2 pb-1" role="group" aria-label="Shows">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                aria-label={`Show ${i + 1}: ${it.title}`}
                aria-current={i === index || undefined}
                onClick={() => setIndex(i)}
                // QA-F-17: a 44px hit area around a small dot.
                className="grid size-11 place-items-center"
              >
                <span
                  className={cx(
                    "block h-2 rounded-full bg-white transition-[width,opacity] duration-300",
                    i === index ? "w-5 opacity-100" : "w-2 opacity-50",
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

/** Four little equaliser bars: the "live soon" pulse. Still under reduced motion. */
function EqBars({ still }: { still: boolean }) {
  return (
    <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
      {[0.5, 1, 0.7, 0.9].map((h, i) => (
        <motion.span
          key={i}
          className="block w-[3px] origin-bottom rounded-full bg-lime"
          style={{ height: "100%", scaleY: h }}
          animate={still ? undefined : { scaleY: [h, 0.25, 1, h * 0.6, h] }}
          transition={
            still ? undefined : { duration: 1.1 + i * 0.15, repeat: Infinity, ease: "easeInOut" }
          }
        />
      ))}
    </span>
  );
}

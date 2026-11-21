"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Sticker } from "./ui/Sticker";

/**
 * The hero's "On the board" tile: two count-up numbers and a ticker of the cities on the board,
 * each with a pulsing dot. Server-rendered with the final numbers (no layout shift, nothing to
 * wait for); counts up once in view; static under reduced motion.
 */
export function HeroBoard({ gigs, cities }: { gigs: number; cities: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const row = cities.length > 0 ? [...cities, ...cities] : [];
  return (
    <div
      ref={ref}
      className="pop-in relative flex flex-col justify-between gap-5 overflow-hidden rounded-tile border-2 border-night bg-sky p-5 text-on-block shadow-[5px_6px_0_0_var(--color-night)] [--i:2] sm:p-6 dark:border-line"
    >
      <Sticker tone="night" tilt={-3} emoji="📌" className="self-start">
        On the board
      </Sticker>
      <div className="flex items-end gap-6">
        <Stat value={gigs} one="gig" many="gigs" run={inView && !reduceMotion} />
        <Stat value={cities.length} one="city" many="cities" run={inView && !reduceMotion} />
      </div>
      {row.length > 0 && (
        <div
          role="region"
          aria-label="Cities on the board"
          className="-mx-5 overflow-hidden border-y-2 border-night bg-surface py-2 text-ink sm:-mx-6"
        >
          <ul
            // CSS decides the motion (motion-safe), so server and client render the same markup.
            className="flex w-max hover:[animation-play-state:paused] motion-safe:[animation:marquee_var(--ticker)_linear_infinite]"
            style={{ "--ticker": `${Math.max(12, cities.length * 2.5)}s` } as CSSProperties}
          >
            {row.map((c, i) => (
              <li
                key={`${c}-${i}`}
                aria-hidden={i >= cities.length || undefined}
                className="mr-2 flex items-center gap-1.5 rounded-chip border-2 border-night bg-lime px-2.5 py-0.5 text-sm font-bold whitespace-nowrap text-on-block"
              >
                <span aria-hidden className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-pink opacity-75 motion-safe:animate-ping" />
                  <span className="relative size-2 rounded-full bg-pink" />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  value,
  one,
  many,
  run,
}: {
  value: number;
  one: string;
  many: string;
  run: boolean;
}) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!run) return setShown(value);
    const controls = animate(0, value, {
      duration: 1,
      ease: "easeOut",
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [run, value]);
  return (
    <p className="flex flex-col font-display leading-none font-extrabold">
      <span className="text-[3.5rem] tabular-nums sm:text-[4.5rem]">{shown}</span>
      <span className="text-lg">{value === 1 ? one : many}</span>
    </p>
  );
}

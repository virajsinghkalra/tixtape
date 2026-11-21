"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import { SPRING_SOFT } from "./motion";
import { TONE_CLASS, type Tone } from "./tone";

export type Story = {
  id: string;
  tone: Tone;
  label: string;
  content: ReactNode;
  /** The slide shows a photo: light progress bars and arrows read on it. */
  dark?: boolean;
};

type Props = {
  slides: Story[];
  /** Accessible name of the whole story, e.g. "Lollapalooza in 5 slides". */
  title: string;
  className?: string;
} & (
  | { variant?: "inline" }
  | { variant: "modal"; open: boolean; onClose: () => void; autoAdvanceMs?: number }
);

/**
 * Swipeable story slides (Wrapped-style). Native scroll-snap does the swiping, so touch, trackpad
 * and keyboard all work; progress bars and arrow buttons sit on top. `modal` adds a full-screen
 * dialog with tap zones and auto-advance (off under reduced motion).
 */
export function StoryViewer(props: Props) {
  if (props.variant === "modal") return <ModalStory {...props} />;
  return (
    <StoryTrack
      slides={props.slides}
      title={props.title}
      className={cx("rounded-tile", props.className)}
    />
  );
}

function ModalStory(props: Extract<Props, { variant: "modal" }>) {
  const { open, onClose, slides, title, autoAdvanceMs = 5000 } = props;
  const reduceMotion = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[60] grid place-items-center bg-night/90 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <motion.div
            className="relative h-dvh w-full sm:h-[min(85dvh,46rem)] sm:max-w-sm"
            initial={reduceMotion ? false : { scale: 0.9, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={reduceMotion ? undefined : { scale: 0.95, y: 20 }}
            transition={SPRING_SOFT}
          >
            <StoryTrack
              slides={slides}
              title={title}
              autoAdvanceMs={reduceMotion ? undefined : autoAdvanceMs}
              onEnd={onClose}
              tapZones
              className="h-full sm:rounded-tile"
            />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close story"
              className="absolute top-6 right-3 z-20 grid size-11 place-items-center rounded-full bg-night/70 text-xl text-white"
            >
              <span aria-hidden>✕</span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type TrackProps = {
  slides: Story[];
  title: string;
  className?: string;
  autoAdvanceMs?: number;
  onEnd?: () => void;
  tapZones?: boolean;
};

function StoryTrack({ slides, title, className, autoAdvanceMs, onEnd, tapZones }: TrackProps) {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLOListElement>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const last = slides.length - 1;

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current;
      if (!track) return;
      const target = Math.max(0, Math.min(last, index));
      track.scrollTo({
        left: target * track.clientWidth,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      setCurrent(target);
    },
    [last, reduceMotion],
  );

  useEffect(() => {
    if (!autoAdvanceMs || paused) return;
    const timer = setTimeout(() => (current < last ? goTo(current + 1) : onEnd?.()), autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [autoAdvanceMs, paused, current, last, goTo, onEnd]);

  function onScroll() {
    const track = trackRef.current;
    if (track) setCurrent(Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowRight") goTo(current + 1);
    else if (e.key === "ArrowLeft") goTo(current - 1);
    else return;
    e.preventDefault();
  }

  function onTap(e: MouseEvent<HTMLOListElement>) {
    if ((e.target as Element).closest("a, button, input, select, textarea")) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / Math.max(box.width, 1);
    if (x < 1 / 3) goTo(current - 1);
    else if (x > 2 / 3 && current < last) goTo(current + 1);
    else if (x > 2 / 3) onEnd?.();
  }

  const slide = slides[current];
  const onDark = slide?.dark || slide?.tone === "violet" || slide?.tone === "night";

  return (
    <section
      aria-roledescription="carousel"
      aria-label={title}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className={cx("relative isolate overflow-hidden", className)}
    >
      <div
        aria-hidden
        className={cx(
          "absolute inset-x-4 top-3 z-10 flex gap-1.5",
          onDark ? "text-white" : "text-night",
        )}
      >
        {slides.map((s, i) => (
          <span key={s.id} className="h-1 flex-1 overflow-hidden rounded-chip bg-current/25">
            <span
              key={i === current ? `run-${current}` : "static"}
              className="block h-full origin-left bg-current"
              style={progressStyle(i, current, autoAdvanceMs, paused)}
            />
          </span>
        ))}
      </div>

      {/* Tap zones (left third back, right third on) are handled here, not as overlay buttons,
          so links and buttons inside a slide ("Open playlist", "See event") always get the tap.
          Keyboard users have the arrow buttons and arrow keys. */}
      <ol
        ref={trackRef}
        onScroll={onScroll}
        onClick={tapZones ? onTap : undefined}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto"
      >
        {slides.map((s, i) => (
          <li
            key={s.id}
            aria-roledescription="slide"
            aria-label={`${i + 1}/${slides.length}: ${s.label}`}
            className={cx(
              "relative isolate flex min-h-[28rem] w-full shrink-0 snap-start flex-col overflow-hidden px-6 pt-12 pb-20 sm:px-8",
              TONE_CLASS[s.tone],
            )}
          >
            {s.content}
          </li>
        ))}
      </ol>

      <div className="absolute right-4 bottom-4 z-10 flex gap-2">
        <ArrowButton
          label="Previous slide"
          disabled={current === 0}
          onClick={() => goTo(current - 1)}
        >
          ←
        </ArrowButton>
        <ArrowButton
          label="Next slide"
          disabled={current === last}
          onClick={() => goTo(current + 1)}
        >
          →
        </ArrowButton>
      </div>
      <p className="sr-only" aria-live="polite">
        {slide ? `Slide ${current + 1}/${slides.length}: ${slide.label}` : ""}
      </p>
    </section>
  );
}

function progressStyle(
  i: number,
  current: number,
  autoAdvanceMs: number | undefined,
  paused: boolean,
): CSSProperties {
  if (i < current || (i === current && !autoAdvanceMs)) return { transform: "scaleX(1)" };
  if (i > current) return { transform: "scaleX(0)" };
  return {
    animation: `story-progress ${autoAdvanceMs}ms linear forwards`,
    animationPlayState: paused ? "paused" : "running",
  };
}

type ArrowProps = { label: string; disabled: boolean; onClick: () => void; children: ReactNode };

function ArrowButton({ label, disabled, onClick, children }: ArrowProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full bg-night text-lg font-bold text-white transition-transform duration-(--duration-fast) ease-spring active:scale-90 disabled:opacity-40"
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}

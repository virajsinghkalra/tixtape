"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

const COLORS = ["#c6f432", "#ff5fa2", "#6a4df5", "#ff8a3d", "#5cc8ff"];
const PIECES = 36;

/** A one-shot confetti burst. Renders nothing under reduced motion. Remount (`key`) to replay. */
export function Confetti() {
  const reduceMotion = useReducedMotion();
  // Deterministic spread so renders are stable.
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x: Math.cos((i / PIECES) * Math.PI * 2) * (120 + ((i * 37) % 90)),
        y: -140 - ((i * 53) % 120),
        rotate: (i * 47) % 360,
        color: COLORS[i % COLORS.length],
        delay: (i % 6) * 0.02,
      })),
    [],
  );
  if (reduceMotion) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute top-1/2 left-1/2 h-3 w-2 rounded-[2px]"
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 260], opacity: [1, 1, 0], rotate: p.rotate + 360 }}
          transition={{ duration: 1.6, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

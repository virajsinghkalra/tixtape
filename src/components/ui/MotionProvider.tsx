"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * D-084: every `motion` animation honours prefers-reduced-motion (transforms are skipped,
 * opacity stays), including any a component forgets to guard with `useReducedMotion`.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

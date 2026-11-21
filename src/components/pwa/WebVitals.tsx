"use client";

import { useReportWebVitals } from "next/web-vitals";
import { sendUx } from "./ux-beacon";

/** D-084 (OD-4): a 25% sample of page loads reports LCP, INP and CLS as good/ni/poor counts. */
const SAMPLED = typeof window !== "undefined" && Math.random() < 0.25;
const NAMES = { LCP: "lcp", INP: "inp", CLS: "cls" } as const;

export function WebVitals() {
  useReportWebVitals((metric) => {
    const vital = NAMES[metric.name as keyof typeof NAMES];
    if (!SAMPLED || !vital) return;
    sendUx({ vital, value: metric.value, path: window.location.pathname });
  });
  return null;
}

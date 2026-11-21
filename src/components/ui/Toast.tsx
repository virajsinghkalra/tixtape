"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { haptic } from "./feedback";
import { SPRING_SOFT } from "./motion";

type ToastTone = "info" | "error";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi | null>(null);
/** UX #9: one toast at a time, 2.4 s, swipe down to dismiss. */
const VISIBLE_MS = 2400;

/** Wrap the app once; components call `useToast().show(...)`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const reduceMotion = useReducedMotion();

  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setItems([{ id, message, tone }]);
    if (tone === "error") haptic("warn");
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), VISIBLE_MS);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* A live region, not role=status: pages own their single status region. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.p
              key={t.id}
              role={t.tone === "error" ? "alert" : undefined}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } }}
              transition={reduceMotion ? { duration: 0.12 } : SPRING_SOFT}
              drag={reduceMotion ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 40) setItems((list) => list.filter((x) => x.id !== t.id));
              }}
              className={cx(
                "pointer-events-auto max-w-md rounded-chip border-2 border-night px-5 py-3 text-sm font-semibold shadow-[3px_4px_0_0_var(--color-night)]",
                t.tone === "error" ? "bg-pink text-on-block" : "bg-lime text-on-block",
              )}
            >
              {t.message}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

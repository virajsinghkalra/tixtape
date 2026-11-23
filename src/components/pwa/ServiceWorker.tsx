"use client";

import { useEffect, useState } from "react";

/**
 * D-084: registers /sw.js after load, in production builds only (dev and the E2E dev server
 * never get one, so Playwright route mocks keep working). A new version waits until the visitor
 * taps "Refresh", so a deploy never swaps code under someone mid-flow.
 */
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const next = r.installing;
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) setWaiting(next);
        });
      });
    };
    const register = () =>
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((r) => {
          reg = r;
          watch(r);
        })
        .catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    let reloading = false;
    // A first visit gains its first controller when the worker claims the page: that is not an
    // update, and reloading then cut the splash short and double-counted the visit.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    // Long-lived tabs: look for a new version when the visitor comes back.
    const onVisible = () => document.visibilityState === "visible" && reg?.update().catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-20 z-[70] flex justify-center px-4">
      <button
        type="button"
        onClick={() => waiting.postMessage("SKIP_WAITING")}
        className="fade-in min-h-11 rounded-chip border-2 border-night bg-lime px-5 font-semibold text-on-block shadow-[3px_4px_0_0_var(--color-night)] active:translate-y-0.5 active:shadow-none"
      >
        <span aria-hidden>✨</span> New version · Refresh
      </button>
    </div>
  );
}

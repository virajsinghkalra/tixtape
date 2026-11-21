"use client";

import { useEffect } from "react";

/**
 * D-084: a site-wide safety net for hotlinked images. Any <img> that fails to load (now or
 * before hydration) gets `data-broken`, which globals.css hides, so the designed background
 * behind it shows instead of a broken-image icon and alt text. Components that have a richer
 * fallback use `useImageFallback` as well.
 */
export function ImageGuard() {
  useEffect(() => {
    const mark = (img: HTMLImageElement) => img.setAttribute("data-broken", "");
    for (const img of document.images) {
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) mark(img);
    }
    const onError = (e: Event) => {
      if (e.target instanceof HTMLImageElement) mark(e.target);
    };
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement) e.target.removeAttribute("data-broken");
    };
    // Image load and error events don't bubble, so listen in the capture phase.
    document.addEventListener("error", onError, true);
    document.addEventListener("load", onLoad, true);
    return () => {
      document.removeEventListener("error", onError, true);
      document.removeEventListener("load", onLoad, true);
    };
  }, []);
  return null;
}

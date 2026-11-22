"use client";

import { useEffect } from "react";
import { EMAIL_SAVED_EVENT, runSync } from "./saved-sync";

const SESSION_KEY = "tixtape.saved.synced";

/** D-092: one merge per session start, and right after an email is saved. Best-effort. */
export function SavedSync() {
  useEffect(() => {
    const sync = () => void runSync().catch(() => {});
    try {
      if (!sessionStorage.getItem(SESSION_KEY)) {
        sessionStorage.setItem(SESSION_KEY, "1");
        sync();
      }
    } catch {
      // Blocked storage: nothing synced either.
    }
    window.addEventListener(EMAIL_SAVED_EVENT, sync);
    return () => window.removeEventListener(EMAIL_SAVED_EVENT, sync);
  }, []);
  return null;
}

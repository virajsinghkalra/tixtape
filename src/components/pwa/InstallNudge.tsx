"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import {
  isIosSafari,
  parseNudge,
  shouldNudge,
  type NudgeState,
  type Platform,
} from "./install-nudge";
import { track } from "../analytics/track";
import { sendUx } from "./ux-beacon";

const KEY = "tixtape:install";
const SESSION_KEY = "tixtape:visit-counted";
/** Components signal real intent with `window.dispatchEvent(new Event(ENGAGED_EVENT))`. */
export const ENGAGED_EVENT = "tixtape:engaged";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function read(): NudgeState {
  try {
    return parseNudge(localStorage.getItem(KEY));
  } catch {
    return parseNudge(null);
  }
}

function write(state: NudgeState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode: the nudge just never shows.
  }
}

/**
 * D-084 (UX plan #14): a one-time "Add to home" chip. See `install-nudge.ts` for when it shows.
 * Intent: opening a Spotify playlist link, tapping Share, or any `tixtape:engaged` event.
 */
export function InstallNudge() {
  const [show, setShow] = useState<Platform>("none");
  const [iosHelp, setIosHelp] = useState(false);
  const prompt = useRef<InstallPrompt | null>(null);

  useEffect(() => {
    let state = read();
    try {
      if (!sessionStorage.getItem(SESSION_KEY)) {
        sessionStorage.setItem(SESSION_KEY, "1");
        state = { ...state, visits: state.visits + 1 };
        write(state);
      }
    } catch {
      return;
    }
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const platform = (): Platform =>
      prompt.current ? "prompt" : isIosSafari(navigator.userAgent) ? "ios" : "none";

    const maybeShow = () => {
      const s = read();
      const p = platform();
      if (!shouldNudge(s, p, standalone)) return;
      write({ ...s, shown: true });
      sendUx({ metric: "install_prompt_shown" });
      setShow(p);
    };
    const engage = () => {
      const s = read();
      if (!s.engaged) write({ ...s, engaged: true });
      // Let the current action (opening Spotify, the share sheet) finish first.
      setTimeout(maybeShow, 1500);
    };
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('a[href*="open.spotify.com"], button[aria-label^="Share"]')) engage();
    };
    const onPrompt = (e: Event) => {
      e.preventDefault(); // Ours shows after intent instead of Chrome's mini-infobar.
      prompt.current = e as InstallPrompt;
      maybeShow();
    };
    const onInstalled = () => {
      sendUx({ metric: "install_accepted" });
      track("install");
      setShow("none");
    };

    maybeShow();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener(ENGAGED_EVENT, engage);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener(ENGAGED_EVENT, engage);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);

  if (show === "none") return null;

  async function install() {
    if (show === "ios") {
      setIosHelp(true);
      return;
    }
    const p = prompt.current;
    if (!p) return setShow("none");
    await p.prompt();
    await p.userChoice.catch(() => null);
    prompt.current = null;
    setShow("none");
  }

  return (
    <aside
      aria-label="Add Tixtape to your home screen"
      className="slide-up fixed inset-x-4 bottom-24 z-[65] mx-auto max-w-sm rounded-card border-2 border-night bg-surface p-3 text-ink shadow-[4px_5px_0_0_var(--color-night)] sm:bottom-6"
    >
      {iosHelp ? (
        <p className="px-2 py-1 font-semibold">
          Tap <span aria-hidden>⎋</span>
          <span className="sr-only">the Share button</span> Share → Add to Home Screen
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={install} className="flex-1">
            <span aria-hidden>📲</span> Add to home
          </Button>
          <Button variant="ghost" onClick={() => setShow("none")} aria-label="Not now">
            <span aria-hidden>✕</span>
          </Button>
        </div>
      )}
      {iosHelp && (
        <Button variant="ghost" onClick={() => setShow("none")} className="mt-1 w-full">
          Got it
        </Button>
      )}
    </aside>
  );
}

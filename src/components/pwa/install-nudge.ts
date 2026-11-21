/**
 * D-084 (UX plan #14): when to offer "Add to home". Pure rules; `InstallNudge.tsx` wires them
 * to localStorage and the browser.
 *
 * Shown at most once ever, only on the 2nd visit or later, only after real intent (a playlist
 * opened, a share, a save or a calendar add), never when already installed, and only where it
 * can work: Chromium's install prompt, or Safari on iOS (not in-app browsers).
 */

export type NudgeState = {
  /** Sessions seen, counted once per browser session. */
  visits: number;
  engaged: boolean;
  /** Set when the nudge was shown; it never shows again. */
  shown: boolean;
};

export const EMPTY_NUDGE: NudgeState = { visits: 0, engaged: false, shown: false };

export type Platform = "prompt" | "ios" | "none";

export function parseNudge(raw: string | null): NudgeState {
  try {
    const v = JSON.parse(raw ?? "") as Partial<NudgeState>;
    return {
      visits: Number.isInteger(v.visits) && v.visits! >= 0 ? v.visits! : 0,
      engaged: v.engaged === true,
      shown: v.shown === true,
    };
  } catch {
    return EMPTY_NUDGE;
  }
}

export function shouldNudge(s: NudgeState, platform: Platform, standalone: boolean): boolean {
  return !standalone && platform !== "none" && !s.shown && s.engaged && s.visits >= 2;
}

/** iOS Safari proper: in-app browsers (Instagram, Facebook, Chrome/Firefox on iOS) can't install. */
export function isIosSafari(userAgent: string): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent);
  const inApp = /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Line\/|GSA\//.test(userAgent);
  return ios && /Safari\//.test(userAgent) && !inApp;
}

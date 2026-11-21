/**
 * UX #9: haptic feedback, as progressive enhancement. Android: `navigator.vibrate`. iOS 17.4+:
 * toggling a hidden `<input type="checkbox" switch>` through its label plays a system tick.
 * Elsewhere, nothing. Never on scroll, typing or load, and never under reduced motion (taken as
 * the user's "less of this" signal). No information is carried by haptics alone.
 */
export type HapticKind = "tap" | "success" | "warn";

/** Vibration patterns in ms (Android). */
export const HAPTIC_PATTERN: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [12, 40, 12],
  warn: 20,
};

/** Pure: whether to buzz at all in this environment. */
export function hapticsAllowed(env: { reducedMotion: boolean; hidden: boolean }): boolean {
  return !env.reducedMotion && !env.hidden;
}

let iosSwitch: HTMLLabelElement | null = null;

function iosTick(): void {
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: HapticKind): void {
  if (typeof window === "undefined") return;
  const allowed = hapticsAllowed({
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    hidden: document.visibilityState === "hidden",
  });
  if (!allowed) return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(HAPTIC_PATTERN[kind]);
      return;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) iosTick();
  } catch {
    // Feedback is a nicety; never let it break an action.
  }
}

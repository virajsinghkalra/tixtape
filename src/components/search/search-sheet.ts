/**
 * Open/close logic for the search surface (mobile P0, D-088). Pure, so every path is tested.
 *
 * - Phone (≤ 639 px): focusing the search opens a full-screen **sheet**, portaled to <body>
 *   above everything, with its own history entry so the Android back button closes it.
 * - Larger screens: the inline **dropdown**, as before.
 *
 * The reducer returns the side effects to run, in order; the component runs them.
 */
export type SheetMode = "closed" | "dropdown" | "sheet";
export type SheetState = { mode: SheetMode; historyEntry: boolean };

export type SheetEvent =
  | { type: "open"; phone: boolean }
  /** Cancel button, Esc in the sheet, or Esc with an empty box in the dropdown. */
  | { type: "dismiss" }
  /** Focus left the search (dropdown only: the sheet ignores it). */
  | { type: "blur" }
  /** Leaving for another page (a result, a chip, Enter). Keeps the history entry for Back. */
  | { type: "navigate" }
  /** The browser went back (Android back button, swipe back). */
  | { type: "popstate" };

export type SheetEffect =
  | "pushHistory"
  | "historyBack"
  | "focusSheetInput"
  /** Return focus to the inline field that opened the sheet. */
  | "focusTrigger"
  | "blurTrigger";

export const CLOSED: SheetState = { mode: "closed", historyEntry: false };

export function sheetReducer(
  s: SheetState,
  e: SheetEvent,
): { state: SheetState; effects: SheetEffect[] } {
  const same = { state: s, effects: [] as SheetEffect[] };
  switch (e.type) {
    case "open":
      if (s.mode === "sheet") return { state: s, effects: ["focusSheetInput"] };
      if (s.mode === "dropdown") return same;
      return e.phone
        ? {
            state: { mode: "sheet", historyEntry: true },
            effects: ["pushHistory", "focusSheetInput"],
          }
        : { state: { mode: "dropdown", historyEntry: false }, effects: [] };
    case "dismiss":
      if (s.mode === "closed") return same;
      if (s.mode === "dropdown") return { state: CLOSED, effects: ["blurTrigger"] };
      return {
        state: CLOSED,
        effects: s.historyEntry ? ["historyBack", "focusTrigger"] : ["focusTrigger"],
      };
    case "blur":
      return s.mode === "dropdown" ? { state: CLOSED, effects: [] } : same;
    case "navigate":
      return s.mode === "closed" ? same : { state: CLOSED, effects: [] };
    case "popstate":
      return s.mode === "sheet" && s.historyEntry
        ? { state: CLOSED, effects: ["focusTrigger"] }
        : same;
  }
}

import { describe, expect, it } from "vitest";
import { CLOSED, sheetReducer, type SheetEvent, type SheetState } from "./search-sheet";

const SHEET: SheetState = { mode: "sheet", historyEntry: true };
const DROPDOWN: SheetState = { mode: "dropdown", historyEntry: false };

const run = (s: SheetState, e: SheetEvent) => sheetReducer(s, e);

describe("sheetReducer", () => {
  it("phone: opening pushes a history entry and focuses the sheet's input", () => {
    expect(run(CLOSED, { type: "open", phone: true })).toEqual({
      state: SHEET,
      effects: ["pushHistory", "focusSheetInput"],
    });
  });

  it("desktop: opening is the inline dropdown, no history", () => {
    expect(run(CLOSED, { type: "open", phone: false })).toEqual({ state: DROPDOWN, effects: [] });
  });

  it("opening again never pushes a second history entry", () => {
    expect(run(SHEET, { type: "open", phone: true })).toEqual({
      state: SHEET,
      effects: ["focusSheetInput"],
    });
    expect(run(DROPDOWN, { type: "open", phone: false }).effects).toEqual([]);
  });

  it("Cancel / Esc closes the sheet, pops its history entry and returns focus", () => {
    expect(run(SHEET, { type: "dismiss" })).toEqual({
      state: CLOSED,
      effects: ["historyBack", "focusTrigger"],
    });
  });

  it("Esc in the dropdown closes it and leaves the field", () => {
    expect(run(DROPDOWN, { type: "dismiss" })).toEqual({ state: CLOSED, effects: ["blurTrigger"] });
  });

  it("back closes the sheet without another history.back()", () => {
    expect(run(SHEET, { type: "popstate" })).toEqual({ state: CLOSED, effects: ["focusTrigger"] });
    // The popstate caused by our own history.back() after Cancel is ignored.
    expect(run(CLOSED, { type: "popstate" })).toEqual({ state: CLOSED, effects: [] });
  });

  it("a result tap closes it and keeps the entry, so Back returns to ?q=", () => {
    expect(run(SHEET, { type: "navigate" })).toEqual({ state: CLOSED, effects: [] });
  });

  it("blur closes only the dropdown: the sheet stays while focus moves inside it", () => {
    expect(run(DROPDOWN, { type: "blur" })).toEqual({ state: CLOSED, effects: [] });
    expect(run(SHEET, { type: "blur" })).toEqual({ state: SHEET, effects: [] });
  });

  it("closed stays closed", () => {
    for (const e of [{ type: "dismiss" }, { type: "blur" }, { type: "navigate" }] as const) {
      expect(run(CLOSED, e)).toEqual({ state: CLOSED, effects: [] });
    }
  });
});

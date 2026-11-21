import { describe, expect, it } from "vitest";
import {
  emailAsked,
  FRESH,
  noteLoad,
  parsePromptState,
  shouldAskEmail,
  shouldAskNickname,
  type PromptState,
} from "./prompt-rules";

const MIN = 60_000;
const DAY = 86_400_000;
// 2026-11-22 12:00 IST.
const T0 = Date.parse("2026-11-22T06:30:00Z");

const visits = (...loads: [number, boolean][]): PromptState =>
  loads.reduce((s, [t, fresh]) => noteLoad(s, t, fresh), FRESH);

describe("nickname prompt timing (D-090)", () => {
  it("never on the first visit, however many pages it has", () => {
    const s = visits([T0, true], [T0 + 5 * MIN, false], [T0 + 25 * MIN, false]);
    expect(shouldAskNickname(s)).toBe(false);
  });

  it("not on a second tab within 30 minutes of the first visit, same day", () => {
    expect(shouldAskNickname(visits([T0, true], [T0 + 10 * MIN, true]))).toBe(false);
  });

  it("on a new session more than 30 minutes after the first visit", () => {
    expect(shouldAskNickname(visits([T0, true], [T0 + 31 * MIN, true]))).toBe(true);
  });

  it("on a new session on a different IST day, even minutes later", () => {
    // 23:55 IST, then 00:05 IST the next day.
    const late = Date.parse("2026-11-22T18:25:00Z");
    expect(shouldAskNickname(visits([late, true], [late + 10 * MIN, true]))).toBe(true);
  });

  it("when the same tab comes back after 30 idle minutes", () => {
    const s = visits([T0, true], [T0 + 20 * MIN, false], [T0 + 60 * MIN, false]);
    expect(shouldAskNickname(s)).toBe(true);
  });

  it("not within one long session that never goes idle", () => {
    const s = visits([T0, true], [T0 + 20 * MIN, false], [T0 + 40 * MIN, false]);
    expect(shouldAskNickname(s)).toBe(false);
  });

  it.each(["shown", "saved", "skipped"] as const)("at most once: never after %s", (n) => {
    const s = { ...visits([T0, true], [T0 + DAY, true]), nickname: n };
    expect(shouldAskNickname(s)).toBe(false);
  });

  it("not once an email (with a name) is saved", () => {
    const s = { ...visits([T0, true], [T0 + DAY, true]), emailSaved: true };
    expect(shouldAskNickname(s)).toBe(false);
  });
});

describe("email prompt timing (D-090)", () => {
  it("can show at a value moment on any visit", () => {
    expect(shouldAskEmail(FRESH, T0)).toBe(true);
  });

  it("waits 7 days after an ask, and stops after two", () => {
    const once = emailAsked(FRESH, T0);
    expect(shouldAskEmail(once, T0 + 6 * DAY)).toBe(false);
    expect(shouldAskEmail(once, T0 + 7 * DAY)).toBe(true);
    const twice = emailAsked(once, T0 + 7 * DAY);
    expect(shouldAskEmail(twice, T0 + 60 * DAY)).toBe(false);
  });

  it("never once saved", () => {
    expect(shouldAskEmail({ ...FRESH, emailSaved: true }, T0)).toBe(false);
  });
});

describe("stored state", () => {
  it("drops unknown or broken shapes", () => {
    expect(parsePromptState(null)).toEqual(FRESH);
    expect(parsePromptState("{oops")).toEqual(FRESH);
    expect(parsePromptState(JSON.stringify({ nickname: "maybe" }))).toEqual(FRESH);
    const s = visits([T0, true]);
    expect(parsePromptState(JSON.stringify(s))).toEqual(s);
  });
});

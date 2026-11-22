import { describe, expect, it } from "vitest";
import {
  emailAsked,
  FRESH,
  nicknameWaitMs,
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

describe("nickname prompt timing (D-090, 2 minutes)", () => {
  it("not in the first 2 minutes on the app", () => {
    const s = visits([T0, true], [T0 + 1 * MIN, false]);
    expect(shouldAskNickname(s, T0 + 119_000)).toBe(false);
    expect(nicknameWaitMs(s, T0 + 30_000)).toBe(90_000);
  });

  it("on the first visit once 2 minutes are up", () => {
    const s = visits([T0, true]);
    expect(shouldAskNickname(s, T0 + 2 * MIN)).toBe(true);
    expect(nicknameWaitMs(s, T0 + 5 * MIN)).toBe(0);
  });

  it("on a later visit straight away", () => {
    const s = visits([T0, true], [T0 + DAY, true]);
    expect(shouldAskNickname(s, T0 + DAY)).toBe(true);
  });

  it.each(["shown", "saved", "skipped"] as const)("at most once: never after %s", (n) => {
    const s = { ...visits([T0, true]), nickname: n };
    expect(shouldAskNickname(s, T0 + DAY)).toBe(false);
  });

  it("not once an email (with a name) is saved", () => {
    const s = { ...visits([T0, true]), emailSaved: true };
    expect(shouldAskNickname(s, T0 + DAY)).toBe(false);
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

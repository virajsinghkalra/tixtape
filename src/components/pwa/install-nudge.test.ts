import { describe, expect, it } from "vitest";
import { EMPTY_NUDGE, isIosSafari, parseNudge, shouldNudge } from "./install-nudge";

const ready = { visits: 2, engaged: true, shown: false };

describe("shouldNudge", () => {
  it("nudges on the 2nd visit after intent", () =>
    expect(shouldNudge(ready, "prompt", false)).toBe(true));
  it("works on iOS Safari too", () => expect(shouldNudge(ready, "ios", false)).toBe(true));
  it.each([
    ["1st visit", { ...ready, visits: 1 }, "prompt", false],
    ["no intent yet", { ...ready, engaged: false }, "prompt", false],
    ["already shown once", { ...ready, shown: true }, "prompt", false],
    ["already installed", ready, "prompt", true],
    ["can't install here", ready, "none", false],
  ] as const)("not when %s", (_, state, platform, standalone) =>
    expect(shouldNudge(state, platform, standalone)).toBe(false),
  );
});

describe("parseNudge", () => {
  it("reads a saved state", () => expect(parseNudge(JSON.stringify(ready))).toEqual(ready));
  it.each([null, "", "nope", "[]", '{"visits":-3,"engaged":"yes"}'])(
    "falls back safely for %s",
    (raw) => expect(parseNudge(raw)).toEqual(EMPTY_NUDGE),
  );
});

describe("isIosSafari", () => {
  const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  it("accepts Safari on iPhone", () => expect(isIosSafari(safari)).toBe(true));
  it("rejects Chrome on iOS", () =>
    expect(isIosSafari(safari.replace("Version/18.0", "CriOS/130.0"))).toBe(false));
  it("rejects Instagram's in-app browser", () =>
    expect(isIosSafari(`${safari} Instagram 300.0`)).toBe(false));
  it("rejects Android", () =>
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36")).toBe(
      false,
    ));
});

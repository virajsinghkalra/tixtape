import { describe, expect, it } from "vitest";
import { canPrefetch, eventIdFromHref, isNewPage, isPlainClick, shellTitle } from "./nav-intent";

const ORIGIN = "https://tixtape.vercel.app";
const ID = "c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3";
const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
  download: false,
};

describe("eventIdFromHref", () => {
  it.each([
    [`/events/${ID}`, ID],
    [`/events/${ID}/`, ID],
    [`/events/${ID}?artist=Anyma`, ID],
    [`${ORIGIN}/events/${ID}#playlist`, ID],
    [`/events/not-a-uuid`, null],
    [`/events/${ID}/edit`, null],
    [`/search?q=x`, null],
    [`https://evil.example/events/${ID}`, null],
    [`http://[bad`, null],
  ])("%s → %s", (href, expected) => {
    expect(eventIdFromHref(href, ORIGIN)).toBe(expected);
  });
});

describe("isPlainClick", () => {
  it("accepts a plain left click", () => expect(isPlainClick(plain)).toBe(true));
  it.each([
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { target: "_blank" },
    { download: true },
  ])("rejects %o", (change) => expect(isPlainClick({ ...plain, ...change })).toBe(false));
  it("treats target=_self as this tab", () =>
    expect(isPlainClick({ ...plain, target: "_self" })).toBe(true));
});

describe("isNewPage", () => {
  const here = { origin: ORIGIN, pathname: `/events/${ID}` };
  it("is false for a hash on the same page", () =>
    expect(isNewPage(`/events/${ID}#playlist`, here)).toBe(false));
  it("is true for another page", () => expect(isNewPage("/", here)).toBe(true));
});

describe("canPrefetch", () => {
  it.each([
    [undefined, true],
    [{ effectiveType: "4g" }, true],
    [{ effectiveType: "3g" }, true],
    [{ effectiveType: "2g" }, false],
    [{ effectiveType: "slow-2g" }, false],
    [{ saveData: true, effectiveType: "4g" }, false],
  ])("%o → %s", (connection, expected) => expect(canPrefetch(connection)).toBe(expected));
});

describe("shellTitle", () => {
  it("prefers the heading and squashes whitespace", () =>
    expect(shellTitle("  Lolla\n  India ", "ignored")).toBe("Lolla India"));
  it("falls back to the link text", () => expect(shellTitle(null, " Anyma ")).toBe("Anyma"));
  it("caps long titles", () => expect(shellTitle("x".repeat(120), null)).toHaveLength(80));
});

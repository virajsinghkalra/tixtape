import { describe, expect, it } from "vitest";
import {
  MIN_AWAY_MS,
  parseSeen,
  sharePageUrl,
  shouldOfferShare,
  whatsAppUrl,
  withSeen,
} from "./after-play";

const base = {
  seen: [] as string[],
  eventId: "e1",
  shownThisVisit: false,
  awayMs: MIN_AWAY_MS,
  otherSheetOpen: false,
};

describe("shouldOfferShare", () => {
  it("asks once someone is back from a real listen", () => {
    expect(shouldOfferShare(base)).toBe(true);
  });
  it("never asks twice for a show, twice a visit, over another sheet, or after a stray tap", () => {
    expect(shouldOfferShare({ ...base, seen: ["e1"] })).toBe(false);
    expect(shouldOfferShare({ ...base, shownThisVisit: true })).toBe(false);
    expect(shouldOfferShare({ ...base, otherSheetOpen: true })).toBe(false);
    expect(shouldOfferShare({ ...base, awayMs: MIN_AWAY_MS - 1 })).toBe(false);
  });
});

describe("seen list", () => {
  it("survives junk and stays short", () => {
    expect(parseSeen("nope")).toEqual([]);
    expect(parseSeen('["a",1,"b"]')).toEqual(["a", "b"]);
    const many = Array.from({ length: 60 }, (_, i) => `e${i}`);
    expect(withSeen(many, "x")).toHaveLength(50);
    expect(withSeen(["a", "b"], "a")).toEqual(["b", "a"]);
  });
});

describe("share links", () => {
  it("tags the show page and builds a WhatsApp link", () => {
    const page = sharePageUrl("https://tixtape.vercel.app", "e1", "wa");
    expect(page).toBe("https://tixtape.vercel.app/events/e1?via=wa");
    expect(whatsAppUrl("gig playlist 🎧", page)).toBe(
      `https://wa.me/?text=${encodeURIComponent(`gig playlist 🎧 ${page}`)}`,
    );
  });
});

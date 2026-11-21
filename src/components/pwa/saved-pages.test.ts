import { describe, expect, it } from "vitest";
import { savedPageTitle } from "./saved-pages";

describe("savedPageTitle", () => {
  it.each([
    ["<html><head><title>Lolla India · Tixtape</title></head>", "Lolla India"],
    ["<title>AP Dhillon &amp; Friends · Tixtape</title>", "AP Dhillon & Friends"],
    [
      "<title>Tixtape · Every ticket gets a mixtape</title>",
      "Tixtape · Every ticket gets a mixtape",
    ],
    ["<title></title>", "Saved gig"],
    ["no title at all", "Saved gig"],
  ])("%s → %s", (html, expected) => expect(savedPageTitle(html)).toBe(expected));
});

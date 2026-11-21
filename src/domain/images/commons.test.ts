import { describe, expect, it } from "vitest";
import { commonsFileName, commonsThumbUrl } from "./commons";

const ORIGINAL =
  "https://upload.wikimedia.org/wikipedia/commons/c/c9/Thievery_Corporation.jpg?utm_source=commons.wikimedia.org";

describe("commonsThumbUrl", () => {
  it.each([
    [
      ORIGINAL,
      2800,
      500,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Thievery_Corporation.jpg/500px-Thievery_Corporation.jpg",
    ],
    [
      ORIGINAL,
      2800,
      330,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Thievery_Corporation.jpg/330px-Thievery_Corporation.jpg",
    ],
    [
      ORIGINAL,
      400,
      500,
      "https://upload.wikimedia.org/wikipedia/commons/c/c9/Thievery_Corporation.jpg",
    ],
    [
      ORIGINAL,
      500,
      500,
      "https://upload.wikimedia.org/wikipedia/commons/c/c9/Thievery_Corporation.jpg",
    ],
    [
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.svg",
      2000,
      500,
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Logo.svg/500px-Logo.svg.png",
    ],
    ["https://upload.wikimedia.org/wikipedia/commons/a/ab/Scan.tif", 4000, 500, null],
    ["https://upload.wikimedia.org/wikipedia/en/a/ab/Cover.jpg", 4000, 500, null],
    ["http://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg", 4000, 500, null],
    ["https://example.com/wikipedia/commons/a/ab/X.jpg", 4000, 500, null],
  ] as const)("%s (%dpx) at %d → %s", (url, original, width, expected) => {
    expect(commonsThumbUrl(url, original, width)).toBe(expected);
  });
});

describe("commonsFileName", () => {
  it.each([
    [ORIGINAL, "Thievery Corporation.jpg"],
    [
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Shreya_Ghoshal_%28cropped%29.jpg/320px-Shreya_Ghoshal_%28cropped%29.jpg",
      "Shreya Ghoshal (cropped).jpg",
    ],
    ["https://upload.wikimedia.org/wikipedia/en/c/c9/Album_cover.jpg", null],
    ["https://upload.wikimedia.org/wikipedia/commons/c/c9/Bad%E0%A4.jpg", null],
    ["not a url", null],
  ])("%s → %s", (url, expected) => {
    expect(commonsFileName(url)).toBe(expected);
  });
});

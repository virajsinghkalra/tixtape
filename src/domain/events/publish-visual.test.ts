import { describe, expect, it } from "vitest";
import { checkPublishVisual, type EventVisual } from "./publish-visual";

const img = "https://i.scdn.co/image/ab67616d.jpg";
const none = { imageUrl: null, altImageUrl: null };

describe("checkPublishVisual (D-091)", () => {
  it.each<[string, EventVisual | null, ReturnType<typeof checkPublishVisual>]>([
    [
      "a poster",
      { posterUrl: "https://sunburn.in/poster.jpg", headliners: [none] },
      { ok: true, via: "poster" },
    ],
    [
      "a headliner with a Spotify photo",
      { posterUrl: null, headliners: [none, { imageUrl: img, altImageUrl: null }] },
      { ok: true, via: "headliner_photo" },
    ],
    [
      "a headliner with only an alternative photo",
      { posterUrl: null, headliners: [{ imageUrl: null, altImageUrl: img }] },
      { ok: true, via: "headliner_photo" },
    ],
    [
      "nothing at all",
      { posterUrl: null, headliners: [none, none] },
      { ok: false, reason: "no_image" },
    ],
    [
      "no headliners and no poster",
      { posterUrl: null, headliners: [] },
      { ok: false, reason: "no_image" },
    ],
    [
      "an unsafe poster URL",
      { posterUrl: "javascript:alert(1)", headliners: [none] },
      { ok: false, reason: "no_image" },
    ],
    [
      "a data: photo",
      {
        posterUrl: null,
        headliners: [{ imageUrl: "data:image/png;base64,AAAA", altImageUrl: null }],
      },
      { ok: false, reason: "no_image" },
    ],
    ["an unknown event", null, { ok: false, reason: "no_image" }],
  ])("%s", (_label, visual, expected) => {
    expect(checkPublishVisual(visual)).toEqual(expected);
  });
});

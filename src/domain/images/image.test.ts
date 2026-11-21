import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_POLICY,
  isFreeLicense,
  isImageCheckDue,
  photoCredit,
  plainText,
  rejectionReason,
  selectImage,
  type ImageCandidate,
} from "./image";

const cand = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/500px-X.jpg",
  credit: "Photo: A, CC BY-SA 4.0, Wikimedia Commons",
  license: "CC BY-SA 4.0",
  source: "wikimedia",
  confidence: 0.8,
  evidence: [],
  ...over,
});

describe("isFreeLicense", () => {
  it.each([
    ["CC BY-SA 4.0", true],
    ["CC BY 2.0", true],
    ["CC BY-SA 3.0 de", true],
    ["CC0", true],
    ["Public domain", true],
    ["PD-US", true],
    ["CC BY-NC 4.0", false],
    ["CC BY-ND 4.0", false],
    ["Fair use", false],
    ["All rights reserved", false],
    ["", false],
    [null, false],
  ])("%j → %s", (license, expected) => {
    expect(isFreeLicense(license)).toBe(expected);
  });
});

describe("rejectionReason", () => {
  it.each([
    ["a free Commons photo", cand(), null],
    ["a non-free licence", cand({ license: "CC BY-NC 4.0" }), "licence not free: CC BY-NC 4.0"],
    ["no licence", cand({ license: null }), "licence not free: unknown"],
    ["low confidence", cand({ confidence: 0.5 }), "confidence 0.5 below minimum"],
    [
      "http",
      cand({ url: "http://upload.wikimedia.org/x.jpg" }),
      "url is not https on an allowed host",
    ],
    [
      "another host for wikimedia",
      cand({ url: "https://example.com/x.jpg" }),
      "url is not https on an allowed host",
    ],
    ["not a URL", cand({ url: "javascript:alert(1)" }), "url is not https on an allowed host"],
    [
      "an official poster on its own domain",
      cand({ source: "official", license: null, url: "https://www.sunburn.in/p.jpg" }),
      null,
    ],
    [
      "a Spotify image",
      cand({ source: "spotify", license: null, url: "https://i.scdn.co/image/x" }),
      null,
    ],
    [
      "a Spotify image elsewhere",
      cand({ source: "spotify", license: null, url: "https://evil.example/x" }),
      "url is not https on an allowed host",
    ],
  ])("%s → %s", (_label, c, expected) => {
    expect(rejectionReason(c, DEFAULT_IMAGE_POLICY)).toBe(expected);
  });
});

describe("selectImage", () => {
  const spotify = cand({
    source: "spotify",
    license: null,
    url: "https://i.scdn.co/image/s",
    confidence: 0.7,
  });
  const official = cand({
    source: "official",
    license: null,
    url: "https://site.in/p.jpg",
    confidence: 0.9,
  });
  const commons = cand({ confidence: 1 });

  it.each([
    ["trust order beats confidence", [commons, official, spotify], spotify],
    ["official before wikimedia", [commons, official], official],
    ["the only acceptable one", [cand({ license: "CC BY-NC 4.0" }), commons], commons],
    ["the most confident within a source", [cand({ confidence: 0.75 }), commons], commons],
    ["nothing acceptable", [cand({ confidence: 0.2 })], null],
    ["no candidates", [], null],
  ])("%s", (_label, candidates, expected) => {
    expect(selectImage(candidates)).toBe(expected);
  });

  it("drops sources the policy doesn't list", () => {
    expect(selectImage([commons], { ...DEFAULT_IMAGE_POLICY, trustOrder: ["spotify"] })).toBeNull();
  });
});

describe("isImageCheckDue", () => {
  const now = new Date("2026-11-22T00:00:00Z");
  it.each([
    ["never checked", null, {}, true],
    ["checked 29 days ago", new Date("2026-10-24T00:00:00Z"), {}, false],
    ["checked 30 days ago", new Date("2026-10-23T00:00:00Z"), {}, true],
    ["checked today but the link is broken", now, { linkBroken: true }, true],
  ] as const)("%s → %s", (_label, checkedAt, opts, expected) => {
    expect(isImageCheckDue(checkedAt, now, opts)).toBe(expected);
  });
});

describe("credits", () => {
  it.each([
    [
      '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane &amp; Co</a>',
      "CC BY-SA 4.0",
      "Photo: Jane & Co, CC BY-SA 4.0, Wikimedia Commons",
    ],
    [null, "CC0", "Photo: Wikimedia Commons, CC0"],
    ["<span></span>", "CC BY 2.0", "Photo: Wikimedia Commons, CC BY 2.0"],
  ])("%j, %j → %j", (author, license, expected) => {
    expect(photoCredit(author, license, "Wikimedia Commons")).toBe(expected);
  });

  it("strips tags and decodes entities", () => {
    expect(plainText("<b>A</b>&nbsp;&lt;B&gt; <script>x</script>")).toBe("A <B> x");
  });
});

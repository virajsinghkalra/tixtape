import { describe, expect, it } from "vitest";
import { detectPlatform, remindRoute } from "./platform";
import { parseSpotifyUrl, spotifyOpenPlan } from "./spotify-link";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iosInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone15,2; iOS 18_1; en_IN; en-IN; scale=3.00; 1179x2556; 123456789)",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  androidWhatsApp:
    "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]",
  line: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0",
  ipadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

describe("detectPlatform", () => {
  it.each([
    [UA.iosSafari, 5, { os: "ios", inApp: null }],
    [UA.iosInstagram, 5, { os: "ios", inApp: "instagram" }],
    [UA.androidChrome, 5, { os: "android", inApp: null }],
    [UA.androidWhatsApp, 5, { os: "android", inApp: "whatsapp" }],
    [UA.androidFacebook, 5, { os: "android", inApp: "facebook" }],
    [UA.line, 5, { os: "ios", inApp: "line" }],
    [UA.ipadOs, 5, { os: "ios", inApp: null }],
    [UA.desktopChrome, 0, { os: "other", inApp: null }],
    [UA.ipadOs, 0, { os: "other", inApp: null }], // a real Mac
  ])("%s", (ua, touch, expected) => {
    expect(detectPlatform(ua, touch)).toEqual(expected);
  });
});

describe("remindRoute", () => {
  it.each([
    [{ os: "ios", inApp: null }, "ics"],
    [{ os: "ios", inApp: "instagram" }, "google"],
    [{ os: "android", inApp: null }, "google"],
    [{ os: "android", inApp: "whatsapp" }, "google"],
    [{ os: "other", inApp: null }, "choose"],
  ] as const)("%j → %s", (p, expected) => {
    expect(remindRoute(p)).toBe(expected);
  });
});

const WEB = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc";

describe("parseSpotifyUrl", () => {
  it.each([
    [WEB, { kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M" }],
    [
      "https://open.spotify.com/intl-en/album/4aawyAB9vmqN3uQ7FjRGTy",
      { kind: "album", id: "4aawyAB9vmqN3uQ7FjRGTy" },
    ],
    [
      "https://open.spotify.com/artist/4gzpq5DPGxSnKTe4SA8HAU/",
      { kind: "artist", id: "4gzpq5DPGxSnKTe4SA8HAU" },
    ],
    ["https://open.spotify.com/user/someone", null],
    ["http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", null],
    ["https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M", null],
    ["not a url", null],
  ])("%s", (url, expected) => {
    expect(parseSpotifyUrl(url)).toEqual(expected);
  });
});

describe("spotifyOpenPlan", () => {
  it("Android in-app webview: an intent handing the https link to the Spotify app", () => {
    const plan = spotifyOpenPlan(WEB, { os: "android", inApp: "whatsapp" });
    expect(plan).toEqual({
      kind: "intent",
      web: WEB,
      href:
        "intent://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M#Intent;scheme=https;" +
        `package=com.spotify.music;S.browser_fallback_url=${encodeURIComponent(WEB)};end`,
    });
  });

  it("Android Chrome: the plain https App Link", () => {
    expect(spotifyOpenPlan(WEB, { os: "android", inApp: null })).toEqual({ kind: "web", web: WEB });
  });

  it("iOS: the spotify: scheme with a timed web fallback", () => {
    expect(spotifyOpenPlan(WEB, { os: "ios", inApp: "instagram" })).toEqual({
      kind: "scheme",
      href: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
      web: WEB,
      fallbackMs: 1200,
    });
  });

  it("desktop and unknown links stay on the web", () => {
    expect(spotifyOpenPlan(WEB, { os: "other", inApp: null })).toEqual({ kind: "web", web: WEB });
    const odd = "https://open.spotify.com/user/x";
    expect(spotifyOpenPlan(odd, { os: "ios", inApp: null })).toEqual({ kind: "web", web: odd });
  });
  it("iOS Safari uses the universal https link (no scheme error without the app)", () => {
    expect(spotifyOpenPlan(WEB, { os: "ios", inApp: null })).toEqual({ kind: "web", web: WEB });
  });
});

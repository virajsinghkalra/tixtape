import { describe, expect, it } from "vitest";
import { isBotUserAgent } from "./bots";
import { classifyReferrer, cleanTag, trafficSource } from "./source";

describe("classifyReferrer (D-090)", () => {
  it.each([
    ["web.whatsapp.com", "whatsapp"],
    ["wa.me", "whatsapp"],
    ["android-app://com.whatsapp/", "whatsapp"],
    ["l.instagram.com", "instagram"],
    ["www.instagram.com", "instagram"],
    ["www.google.com", "google"],
    ["google.co.in", "google"],
    ["android-app://com.google.android.googlequicksearchbox", "google"],
    ["lm.facebook.com", "facebook"],
    ["t.co", "twitter"],
    ["x.com", "twitter"],
    ["", "direct"],
    [null, "direct"],
    ["tixtape.vercel.app", "direct"],
    ["news.ycombinator.com", "other"],
    ["notgoogle.com", "other"],
    ["whatsapp.com.evil.example", "other"],
  ] as const)("%s → %s", (host, kind) => {
    expect(classifyReferrer(host, "tixtape.vercel.app")).toBe(kind);
  });
});

describe("trafficSource (D-090)", () => {
  it("prefers UTM tags, cleaned", () => {
    expect(
      trafficSource({ us: "Insta Story!", um: "Social", uc: "Lolla 2026", ref: "wa.me" }),
    ).toEqual({ source: "insta_story", medium: "social", campaign: "lolla_2026" });
  });

  it("then the referrer class", () => {
    expect(trafficSource({ ref: "l.instagram.com", via: "wa" })).toEqual({
      source: "instagram",
      medium: null,
      campaign: null,
    });
  });

  it("then our share tag", () => {
    expect(trafficSource({ via: "wa" }).source).toBe("whatsapp");
    expect(trafficSource({ via: "ig" }).source).toBe("instagram");
    expect(trafficSource({ via: "native" }).source).toBe("share");
    expect(trafficSource({ via: "copy" }).source).toBe("share");
  });

  it("else direct", () => {
    expect(trafficSource(undefined).source).toBe("direct");
    expect(trafficSource({ ref: "tixtape.vercel.app" }, "tixtape.vercel.app").source).toBe(
      "direct",
    );
  });

  it("never keeps a URL or query string", () => {
    expect(cleanTag("https://evil.example/?q=me@x.com")).toBe("https_evil.example_q_me_x.com");
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag("a".repeat(100))?.length).toBe(40);
  });
});

describe("isBotUserAgent (D-090)", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0 A",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "",
  ])("%s is a bot", (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0",
  ])("%s is a person", (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });
});

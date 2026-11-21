/** QA P2.1: playlist name and description (D-040). */
import { describe, expect, it } from "vitest";
import {
  MAX_PLAYLIST_DESCRIPTION,
  MAX_PLAYLIST_NAME,
  playlistDescription,
  playlistName,
} from "@/domain/playlists/naming";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDFFF]/.test(s) &&
  (() => {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = s.charCodeAt(i + 1);
        if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
        i += 1;
      } else if (c >= 0xdc00 && c <= 0xdfff) return true;
    }
    return false;
  })();
const UPDATED = new Date("2026-11-21T10:00:00Z");

describe("QA D-040 name", () => {
  it("is `{title} · Tixtape`", () => {
    expect(MAX_PLAYLIST_NAME).toBe(100);
    expect(playlistName("NH7 Weekender 2026")).toBe("NH7 Weekender 2026 · Tixtape");
  });

  it.each([1, 50, 87, 88, 89, 100, 101, 500, 5000])(
    "title of %i chars stays ≤ 100 and keeps the suffix",
    (len) => {
      const name = playlistName("x".repeat(len));
      expect(name.length).toBeLessThanOrEqual(100);
      expect(name.endsWith(" · Tixtape")).toBe(true);
    },
  );

  it("an exactly-fitting title is not truncated", () => {
    const title = "y".repeat(100 - " · Tixtape".length);
    expect(playlistName(title)).toBe(`${title} · Tixtape`);
  });

  it("never splits a surrogate pair when truncating emoji titles", () => {
    for (let len = 40; len < 70; len += 1) {
      const name = playlistName("🎸".repeat(len));
      expect(name.length).toBeLessThanOrEqual(100);
      expect(hasLoneSurrogate(name)).toBe(false);
      expect(LONE_SURROGATE.test(name)).toBe(false);
    }
  });

  it("handles Devanagari / combining marks and RTL titles", () => {
    for (const title of [
      "लोलापालूज़ा इंडिया ".repeat(10),
      "مهرجان الموسيقى ".repeat(10),
      "Beyoncé ".repeat(20),
    ]) {
      const name = playlistName(title);
      expect(name.length).toBeLessThanOrEqual(100);
      expect(name.endsWith(" · Tixtape")).toBe(true);
      expect(name.normalize("NFC").length).toBeGreaterThan(0);
    }
  });
});

describe("QA D-040 description", () => {
  it("matches the template", () => {
    expect(MAX_PLAYLIST_DESCRIPTION).toBe(300);
    expect(playlistDescription("Lollapalooza India", UPDATED)).toBe(
      "Songs from the Lollapalooza India lineup. Updated 21 Nov. Popularity data: Last.fm. Live setlists: setlist.fm. Made with Tixtape.",
    );
  });

  it.each([10, 200, 300, 1000])(
    "stays ≤ 300 with a %i-char title and keeps the Last.fm credit",
    (len) => {
      const d = playlistDescription("z".repeat(len), UPDATED);
      expect(d.length).toBeLessThanOrEqual(300);
      // Last.fm's terms require attribution, so truncation must cut the title, not the credit.
      expect(d).toContain("Popularity data: Last.fm.");
      expect(d).toContain("Updated 21 Nov.");
    },
  );

  it("never splits a surrogate pair", () => {
    for (let len = 100; len < 160; len += 1) {
      const d = playlistDescription("🎤".repeat(len), UPDATED);
      expect(d.length).toBeLessThanOrEqual(300);
      expect(hasLoneSurrogate(d)).toBe(false);
    }
  });

  it.each([
    ["2026-01-05T00:00:00Z", "5 Jan"],
    ["2026-12-31T12:00:00Z", "31 Dec"],
  ])("date %s renders as %s (d MMM, no leading zero)", (iso, text) => {
    expect(playlistDescription("X", new Date(iso))).toContain(`Updated ${text}.`);
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_PLAYLIST_DESCRIPTION,
  MAX_PLAYLIST_NAME,
  playlistDescription,
  playlistName,
} from "./naming";

describe("playlistName", () => {
  it("appends the suffix", () => {
    expect(playlistName(" NH7 Weekender ")).toBe("NH7 Weekender · Tixtape");
  });

  it("clips long titles to 100 characters", () => {
    const name = playlistName("x".repeat(300));
    expect(name).toHaveLength(MAX_PLAYLIST_NAME);
    expect(name.endsWith("… · Tixtape")).toBe(true);
  });
});

describe("playlistDescription", () => {
  it("follows D-040 with a UTC date", () => {
    expect(playlistDescription("NH7 Weekender", new Date("2026-12-05T23:30:00Z"))).toBe(
      "Songs from the NH7 Weekender lineup. Updated 5 Dec. Popularity data: Last.fm. Live setlists: setlist.fm. Made with Tixtape.",
    );
  });

  it("stays within 300 characters", () => {
    const d = playlistDescription("y".repeat(400), new Date("2026-01-01T00:00:00Z"));
    expect(d.length).toBeLessThanOrEqual(MAX_PLAYLIST_DESCRIPTION);
    expect(d).toContain("Updated 1 Jan.");
  });
});

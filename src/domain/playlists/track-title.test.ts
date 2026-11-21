import { describe, expect, it } from "vitest";
import { normalizeTrackTitle, trackVersion } from "./track-title";

describe("trackVersion", () => {
  it.each([
    ["Tum Hi Ho", null],
    ["Live Forever", null],
    ["Acoustic Guitar Song", null],
    ["Tum Hi Ho (Live)", "live"],
    ["Tum Hi Ho - Live at Royal Albert Hall", "live"],
    ["Baarishein (Unplugged)", "acoustic"],
    ["Kho Gaye - Acoustic Version", "acoustic"],
    ["Cold Mess (Nucleya Remix)", "remix"],
    ["Cold Mess [RMX]", "remix"],
    ["Kesariya (Karaoke Version)", "karaoke"],
    ["Kesariya (Sped Up)", "sped_up"],
    ["Kesariya - sped up + reverb", "sped_up"],
    ["Kesariya (Slowed + Reverb)", "slowed"],
    ["Kesariya (Instrumental)", "instrumental"],
    ['Kesariya (From "Brahmastra")', null],
    ["Song - Remastered 2011", null],
    ["Song (feat. Someone)", null],
    ["Song (Part 2)", null],
  ])("%s → %s", (title, expected) => {
    expect(trackVersion(title)).toBe(expected);
  });
});

describe("normalizeTrackTitle", () => {
  it.each([
    ['Kesariya (From "Brahmastra")', "kesariya"],
    ["Kesariya", "kesariya"],
    ["KESARIYA!", "kesariya"],
    ["Tum Hi Ho - Live", "tum hi ho"],
    ["Tum Hi Ho (Live) [Remastered 2020]", "tum hi ho"],
    ["Song feat. Someone", "song"],
    ["Song (with Someone)", "song"],
    ["Song - Remastered 2011", "song"],
    ["Song (Part 2)", "song part 2"],
    ["Café del Mar", "cafe del mar"],
    ["Rock & Roll", "rock and roll"],
    ["(Live)", "live"],
  ])("%s → %s", (title, expected) => {
    expect(normalizeTrackTitle(title)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const t of ['Kesariya (From "Brahmastra")', "Tum Hi Ho - Live", "Song (Part 2)"]) {
      const once = normalizeTrackTitle(t);
      expect(normalizeTrackTitle(once)).toBe(once);
    }
  });
});

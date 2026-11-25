import { describe, expect, it } from "vitest";
import { findPreviewAudio } from "./itunes";

const reply = (results: unknown[]) =>
  (async () => new Response(JSON.stringify({ results }))) as unknown as typeof fetch;

describe("findPreviewAudio", () => {
  it("picks the same song by the same artist", async () => {
    const f = reply([
      { trackName: "Lover (Remix)", artistName: "Someone Else", previewUrl: "https://x/1.m4a" },
      { trackName: "Lover", artistName: "Diljit Dosanjh", previewUrl: "https://x/2.m4a" },
    ]);
    expect(await findPreviewAudio("Lover", "Diljit Dosanjh", f)).toBe("https://x/2.m4a");
  });
  it("ignores other artists entirely", async () => {
    const f = reply([
      { trackName: "Lover", artistName: "Taylor Swift", previewUrl: "https://x/3.m4a" },
    ]);
    expect(await findPreviewAudio("Lover", "Diljit Dosanjh", f)).toBeNull();
  });
  it("matches past a feat./remaster tail", async () => {
    const f = reply([
      { trackName: "Roses", artistName: "The Chainsmokers", previewUrl: "https://x/4.m4a" },
    ]);
    expect(await findPreviewAudio("Roses (feat. ROZES)", "The Chainsmokers", f)).toBe(
      "https://x/4.m4a",
    );
  });
  it("is null on a network error", async () => {
    const f = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await findPreviewAudio("Roses", "The Chainsmokers", f)).toBeNull();
  });
});

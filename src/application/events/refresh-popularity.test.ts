import { describe, expect, it } from "vitest";
import type { ArtistPopularityStore } from "@/application/ports/event-feed";
import { refreshArtistPopularity } from "./refresh-popularity";

describe("refreshArtistPopularity", () => {
  it("stores listeners, keeps unknown and failed lookups as null (neutral)", async () => {
    const saved: [string, number | null][] = [];
    const store: ArtistPopularityStore = {
      due: async () => [
        { id: "a1", name: "Arijit Singh", mbid: null },
        { id: "a2", name: "Unknown Act", mbid: null },
        { id: "a3", name: "Flaky", mbid: "m3" },
      ],
      save: async (id, listeners) => void saved.push([id, listeners]),
    };
    const source = {
      listeners: async (name: string) => {
        if (name === "Flaky") throw new Error("Last.fm down");
        return name === "Arijit Singh" ? 1_200_000 : null;
      },
    };
    const r = await refreshArtistPopularity(
      { store, source, clock: { now: () => new Date("2026-11-21") } },
      50,
    );
    expect(r).toEqual({ checked: 3, known: 1, failed: 1 });
    expect(saved).toEqual([
      ["a1", 1_200_000],
      ["a2", null],
      ["a3", null],
    ]);
  });
});

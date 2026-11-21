import { describe, expect, it, vi } from "vitest";
import type { EventResult } from "@/domain/events/search";
import { UpstreamError } from "@/lib/errors";
import { MAX_SIMILAR_CHECKED, similarShows } from "./similar-shows";

const ev = (id: string): EventResult => ({
  id,
  title: `Show ${id}`,
  type: "concert",
  startsAt: new Date("2027-01-10T13:30:00Z"),
  startsAtDateOnly: false,
  city: "Mumbai",
  venueName: "NSCI Dome",
});

function deps(similar: string[] | Error, shows: Record<string, EventResult[] | Error>) {
  return {
    similar: {
      similarTo: vi.fn(async () => {
        if (similar instanceof Error) throw similar;
        return similar;
      }),
    },
    showsBy: vi.fn(async (name: string) => {
      const r = shows[name] ?? [];
      if (r instanceof Error) throw r;
      return r;
    }),
    logger: { warn: vi.fn() },
  };
}

describe("similarShows", () => {
  it("maps similar artists to our upcoming shows, most similar first, each event once", async () => {
    const d = deps(["Imagine Dragons", "OneRepublic", "Keane"], {
      "Imagine Dragons": [ev("1")],
      OneRepublic: [ev("2"), ev("1")],
    });
    await expect(similarShows(d, "Coldplay")).resolves.toEqual({
      artists: ["Imagine Dragons", "OneRepublic"],
      shows: [
        { ...ev("1"), artist: "Imagine Dragons" },
        { ...ev("2"), artist: "OneRepublic" },
      ],
    });
    expect(d.showsBy).toHaveBeenCalledWith("Keane", 2);
  });

  it("checks at most a handful of names", async () => {
    const names = Array.from({ length: 15 }, (_, i) => `A${i}`);
    const d = deps(names, {});
    await similarShows(d, "X");
    expect(d.showsBy).toHaveBeenCalledTimes(MAX_SIMILAR_CHECKED);
  });

  it("caps the row at six shows", async () => {
    const d = deps(["A", "B", "C", "D"], {
      A: [ev("1"), ev("2")],
      B: [ev("3"), ev("4")],
      C: [ev("5"), ev("6")],
      D: [ev("7"), ev("8")],
    });
    expect((await similarShows(d, "X")).shows).toHaveLength(6);
  });

  it("Last.fm down → nothing, logged", async () => {
    const d = deps(new UpstreamError("lastfm", "down"), {});
    await expect(similarShows(d, "Coldplay")).resolves.toEqual({ artists: [], shows: [] });
    expect(d.logger.warn).toHaveBeenCalled();
    expect(d.showsBy).not.toHaveBeenCalled();
  });

  it("one failing lookup doesn't hide the others", async () => {
    const d = deps(["A", "B"], { A: new Error("db"), B: [ev("9")] });
    expect((await similarShows(d, "X")).shows.map((s) => s.id)).toEqual(["9"]);
  });
});

import { describe, expect, it } from "vitest";
import { pickTrending } from "./trending";

const ev = (
  id: string,
  playlistUrl: string | null = `https://open.spotify.com/playlist/${id}`,
) => ({
  id,
  playlistUrl,
});

describe("pickTrending", () => {
  it("picks the playable show with the most opens", () => {
    const rows = [ev("a"), ev("b"), ev("c")];
    expect(
      pickTrending(
        rows,
        new Map([
          ["a", 2],
          ["c", 9],
        ]),
      )?.id,
    ).toBe("c");
  });
  it("ignores opens on shows with no playable playlist", () => {
    const rows = [ev("a", null), ev("b")];
    expect(
      pickTrending(
        rows,
        new Map([
          ["a", 50],
          ["b", 1],
        ]),
      )?.id,
    ).toBe("b");
  });
  it("breaks ties by the soonest show", () => {
    const rows = [ev("a"), ev("b")];
    expect(
      pickTrending(
        rows,
        new Map([
          ["a", 3],
          ["b", 3],
        ]),
      )?.id,
    ).toBe("a");
  });
  it("falls back to the preferred big show, then the first playable row", () => {
    const rows = [ev("a", null), ev("b"), ev("c")];
    expect(pickTrending(rows, new Map(), [ev("a", null), ev("c")])?.id).toBe("c");
    expect(pickTrending(rows, new Map())?.id).toBe("b");
  });
  it("is null when nothing is playable", () => {
    expect(pickTrending([ev("a", null)], new Map())).toBeNull();
    expect(pickTrending([], new Map())).toBeNull();
  });
});

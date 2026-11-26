import { describe, expect, it } from "vitest";
import { radioOrder, type RadioInput } from "./radio-order";

const at = (d: number) => new Date(Date.UTC(2026, 11, d));
const row = (o: Partial<RadioInput> & { id: string }): RadioInput => ({
  playlistUrl: `https://open.spotify.com/playlist/${o.id}`,
  startsAt: at(10),
  local: false,
  vibe: "edm",
  heat: 0,
  daysAway: 30,
  ...o,
});

describe("radioOrder", () => {
  it("plays a tour once: the visitor's city, else the soonest date", () => {
    const url = "https://open.spotify.com/playlist/tour";
    const out = radioOrder([
      row({ id: "a", playlistUrl: url, startsAt: at(5) }),
      row({ id: "b", playlistUrl: url, startsAt: at(9), local: true }),
      row({ id: "c", playlistUrl: url, startsAt: at(3) }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("skips shows without a playlist", () => {
    expect(radioOrder([row({ id: "a", playlistUrl: null })])).toEqual([]);
  });

  it("starts with the hottest, then takes turns between vibes", () => {
    const out = radioOrder([
      row({ id: "edm1", vibe: "edm", heat: 9 }),
      row({ id: "edm2", vibe: "edm", heat: 8 }),
      row({ id: "pun1", vibe: "punjabi", heat: 5 }),
      row({ id: "ind1", vibe: "indie", heat: 1 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["edm1", "pun1", "edm2", "ind1"]);
  });

  it("leads with a gig in your city this week, even over a hotter one elsewhere", () => {
    const out = radioOrder([
      row({ id: "far", vibe: "edm", heat: 30 }),
      row({ id: "mine", vibe: "punjabi", heat: 1, local: true, daysAway: 3 }),
    ]);
    expect(out[0]!.id).toBe("mine");
  });

  it("never drops a card", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      row({ id: `x${i}`, vibe: i < 7 ? "edm" : "pop", heat: i }),
    );
    expect(radioOrder(rows)).toHaveLength(9);
  });
});

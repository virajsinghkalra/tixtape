import { describe, expect, it } from "vitest";
import { buildListenNow, pickArtists, pickSibling, type SiblingCandidate } from "./listen-now";

const now = new Date("2026-11-22T00:00:00Z");
const cur = { id: "e0", title: "Band India Tour 2027 – Pune", headlinerIds: ["a", "b"] };
const cand = (o: Partial<SiblingCandidate> & { eventId: string }): SiblingCandidate => ({
  title: "Band India Tour 2027 – Delhi",
  startsAt: new Date("2027-01-10T00:00:00Z"),
  url: `https://open.spotify.com/playlist/${o.eventId}`,
  headlinerIds: ["b", "a"],
  ...o,
});

describe("pickSibling", () => {
  it("takes a ready playlist of the same headliner set, soonest first", () => {
    const later = cand({ eventId: "x", startsAt: new Date("2027-03-01T00:00:00Z") });
    const sooner = cand({ eventId: "y" });
    expect(pickSibling(cur, [later, sooner], now)?.url).toMatch(/y$/);
  });
  it("prefers the same tour stem over a sooner different tour", () => {
    const other = cand({
      eventId: "o",
      title: "Band Summer Fest – Goa",
      startsAt: new Date("2026-12-01T00:00:00Z"),
    });
    const tour = cand({ eventId: "t", startsAt: new Date("2027-06-01T00:00:00Z") });
    expect(pickSibling(cur, [other, tour], now)).toEqual({
      url: "https://open.spotify.com/playlist/t",
      title: "Band India Tour 2027",
    });
  });
  it("ignores different headliner sets and itself", () => {
    const sub = cand({ eventId: "s", headlinerIds: ["a"] });
    const sup = cand({ eventId: "u", headlinerIds: ["a", "b", "c"] });
    expect(pickSibling(cur, [sub, sup, cand({ eventId: "e0" })], now)).toBeNull();
  });
  it("is null with no candidates or no headliners", () => {
    expect(pickSibling(cur, [], now)).toBeNull();
    expect(
      pickSibling({ ...cur, headlinerIds: [] }, [cand({ eventId: "z", headlinerIds: [] })], now),
    ).toBeNull();
  });
});

describe("artists", () => {
  it("keeps the top 3 billed with an id, skipping the rest", () => {
    const billed = [
      { name: "A", spotifyId: null },
      { name: "B", spotifyId: "sb" },
      { name: "C", spotifyId: "sc" },
      { name: "D", spotifyId: "sd" },
      { name: "E", spotifyId: "se" },
    ];
    expect(pickArtists(billed).map((a) => a.name)).toEqual(["B", "C", "D"]);
    expect(pickArtists([{ name: "A", spotifyId: null }])).toEqual([]);
  });
  it("shows the sibling alone when there is one, else the artists", () => {
    const billed = [{ name: "B", spotifyId: "sb" }];
    expect(buildListenNow(cur, billed, [cand({ eventId: "y" })], now)).toMatchObject({
      artists: [],
      sibling: {},
    });
    expect(buildListenNow(cur, billed, [], now)).toEqual({
      artists: [{ name: "B", spotifyId: "sb" }],
    });
  });
});

import { describe, expect, it } from "vitest";
import { laterShows, readyFirst, readyShows, splitByCity, weekShows } from "./browse";

const now = new Date("2026-11-22T00:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
const r = (id: string, d: number, url: string | null, city: string | null = "Mumbai") => ({
  id,
  startsAt: day(d),
  playlistUrl: url,
  city,
});
const rows = [r("c", 30, "u"), r("a", 2, null), r("b", 5, "u", "Chennai"), r("d", 7, null)];

describe("browse selection", () => {
  it("ready: only playable, soonest first", () => {
    expect(readyShows(rows).map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("week vs later split at 7 days", () => {
    expect(weekShows(rows, now).map((x) => x.id)).toEqual(["a", "b"]);
    expect(laterShows(rows, now).map((x) => x.id)).toEqual(["d", "c"]);
  });
  it("city first, same metro counts, no city means all other", () => {
    expect(splitByCity(rows, "Chennai").here.map((x) => x.id)).toEqual(["b"]);
    expect(splitByCity(rows, null).other).toHaveLength(4);
  });
  it("readyFirst is stable", () => {
    expect(readyFirst(rows).map((x) => x.id)).toEqual(["c", "b", "a", "d"]);
  });
});

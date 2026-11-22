import { describe, expect, it } from "vitest";
import {
  backtestArtist,
  predictTitles,
  priorTo,
  type RawSetlist,
  type RawSearch,
} from "./setlistfm-backtest";

const show = (eventDate: string, songs: string[], tour = "T"): RawSetlist => ({
  eventDate,
  artist: { name: "Band" },
  tour: { name: tour },
  sets: { set: [{ song: songs.map((name) => ({ name })) }] },
});

describe("priorTo", () => {
  it("keeps only strictly earlier shows, comparing real dates not strings", () => {
    const all = [show("01-02-2026", ["a"]), show("31-12-2025", ["a"]), show("01-02-2026", ["b"])];
    // string order would put "31-12-2025" after "01-02-2026"
    expect(priorTo(all, all[0]!).map((s) => s.eventDate)).toEqual(["31-12-2025"]);
  });
});

describe("predictTitles", () => {
  it("ranks only from the setlists it is given", async () => {
    const prior = [show("01-01-2026", ["A", "B"]), show("02-01-2026", ["A", "C"])];
    expect((await predictTitles("Band", prior, 1))[0]).toBe("A");
  });
});

describe("backtestArtist", () => {
  it("never lets the predicted show or later shows influence its own prediction", async () => {
    // Targets need >= 6 songs (shorter setlists are incomplete entries, not targets).
    const future = ["F1", "F2", "F3", "F4", "F5", "F6"];
    const past = ["X", "Y", "Z", "W", "V", "U"];
    const body: RawSearch = {
      setlist: [
        show("05-01-2026", future), // target
        show("04-01-2026", past),
        show("03-01-2026", past),
        show("02-01-2026", past),
      ],
    };
    const r = await backtestArtist("Band", body, 1);
    if (r.insufficient) throw new Error("expected data");
    // prior shows only contain X, Y: the target's own songs can never be predicted
    expect(r.shows[0]?.score.hits).toBe(0);
  });

  it("skips partial setlists (< 6 songs) as targets", async () => {
    const full = ["A", "B", "C", "D", "E", "F"];
    const body: RawSearch = {
      setlist: [
        show("05-01-2026", ["A"]),
        show("04-01-2026", full),
        show("03-01-2026", full),
        show("02-01-2026", full),
        show("01-01-2026", full),
      ],
    };
    const r = await backtestArtist("Band", body, 1);
    if (r.insufficient) throw new Error("expected data");
    expect(r.shows[0]?.date).toBe("04-01-2026");
  });

  it("reports insufficient data with fewer than 3 prior setlists", async () => {
    const body: RawSearch = {
      setlist: [show("03-01-2026", ["A"]), show("02-01-2026", ["A"]), show("01-01-2026", ["A"])],
    };
    expect(await backtestArtist("Band", body, 5)).toEqual({ artist: "Band", insufficient: true });
  });
});

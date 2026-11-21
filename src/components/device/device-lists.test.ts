import { describe, expect, it } from "vitest";
import {
  ARTISTS,
  hasItem,
  landedShows,
  parseList,
  readList,
  REMINDED,
  SAVED,
  upcomingSaved,
  withItem,
  withoutItem,
  writeList,
  type DeviceStorage,
  type SavedShow,
} from "./device-lists";

function memoryStorage(
  initial: Record<string, string> = {},
): DeviceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const throwing: DeviceStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const show = (id: string, startsAt: string): SavedShow => ({
  id,
  title: `Show ${id}`,
  startsAt,
  city: "Mumbai",
  savedAt: "2026-11-22T10:00:00.000Z",
});

describe("parseList", () => {
  it("drops unknown shapes, duplicates and junk silently", () => {
    const raw = JSON.stringify([
      show("a", "2026-12-01T13:30:00Z"),
      { id: 42 },
      "nope",
      show("a", "2026-12-02T13:30:00Z"),
      show("b", "2026-12-03T13:30:00Z"),
    ]);
    expect(parseList(SAVED, raw).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it.each([null, "", "{", "{}", "42"])("%j → []", (raw) => {
    expect(parseList(SAVED, raw)).toEqual([]);
  });

  it("caps at the list's max", () => {
    const many = Array.from({ length: 80 }, (_, i) => show(String(i), "2026-12-01T00:00:00Z"));
    expect(parseList(SAVED, JSON.stringify(many))).toHaveLength(50);
  });
});

describe("read and write", () => {
  it("round-trips through storage under a versioned key", () => {
    const s = memoryStorage();
    writeList(SAVED, [show("a", "2026-12-01T13:30:00Z")], s);
    expect(Object.keys(s.data)).toEqual(["tixtape.saved.v1"]);
    expect(readList(SAVED, s).map((x) => x.id)).toEqual(["a"]);
  });

  it("removes the key when the list empties", () => {
    const s = memoryStorage({ "tixtape.reminded.v1": '["x"]' });
    writeList(REMINDED, [], s);
    expect(s.data).toEqual({});
  });

  it("never throws when storage is missing or blocked", () => {
    expect(readList(SAVED, undefined)).toEqual([]);
    expect(readList(SAVED, throwing)).toEqual([]);
    expect(() => writeList(SAVED, [show("a", "x")], throwing)).not.toThrow();
  });
});

describe("withItem / withoutItem / hasItem", () => {
  it("adds newest first and replaces the same id", () => {
    const one = withItem(SAVED, [], show("a", "2026-12-01T00:00:00Z"));
    const two = withItem(SAVED, one, show("b", "2026-12-02T00:00:00Z"));
    const again = withItem(SAVED, two, show("a", "2026-12-05T00:00:00Z"));
    expect(again.map((s) => s.id)).toEqual(["a", "b"]);
    expect(again[0]!.startsAt).toBe("2026-12-05T00:00:00Z");
    expect(hasItem(SAVED, again, "b")).toBe(true);
    expect(withoutItem(SAVED, again, "a").map((s) => s.id)).toEqual(["b"]);
  });

  it("artists de-duplicate ignoring case and spaces", () => {
    const list = withItem(ARTISTS, [{ name: "coldplay", followedAt: "1" }], {
      name: " Coldplay ",
      followedAt: "2",
    });
    expect(list).toEqual([{ name: " Coldplay ", followedAt: "2" }]);
    expect(hasItem(ARTISTS, list, "coldplay")).toBe(true);
  });

  it("artists are capped at 20", () => {
    let list: { name: string; followedAt: string }[] = [];
    for (let i = 0; i < 25; i++) list = withItem(ARTISTS, list, { name: `A${i}`, followedAt: "" });
    expect(list).toHaveLength(20);
    expect(list[0]!.name).toBe("A24");
  });
});

describe("upcomingSaved", () => {
  const now = new Date("2026-12-10T15:00:00Z"); // 20:30 IST, 10 Dec

  it("keeps today's and future shows, soonest first, and drops past days", () => {
    const list = [
      show("later", "2026-12-20T13:30:00Z"),
      show("yesterday", "2026-12-09T13:30:00Z"),
      show("today-date-only", "2026-12-09T18:30:00Z"), // 00:00 IST on 10 Dec
      show("bad", "not a date"),
      show("soon", "2026-12-11T13:30:00Z"),
    ];
    expect(upcomingSaved(list, now).map((s) => s.id)).toEqual(["today-date-only", "soon", "later"]);
  });
});

describe("landedShows", () => {
  const ev = (id: string) => ({
    id,
    title: `Event ${id}`,
    startsAt: "2027-01-01T13:30:00Z",
    city: "Pune",
  });

  it("one show per followed artist, skipping hidden and repeated events", () => {
    const shows = new Map([
      ["coldplay", [ev("1"), ev("2")]],
      ["dua lipa", [ev("1"), ev("3")]],
      ["nobody", []],
    ]);
    const artists = [
      { name: "Coldplay", followedAt: "" },
      { name: "Dua Lipa", followedAt: "" },
      { name: "Nobody", followedAt: "" },
      { name: "Unchecked", followedAt: "" },
    ];
    expect(landedShows(artists, shows, new Set())).toEqual([
      { artist: "Coldplay", event: ev("1") },
      { artist: "Dua Lipa", event: ev("3") },
    ]);
    expect(landedShows(artists, shows, new Set(["1"])).map((l) => l.event.id)).toEqual(["2", "3"]);
  });
});

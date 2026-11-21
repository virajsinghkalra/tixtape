import { describe, expect, it, vi } from "vitest";
import { cityChips, dateChips } from "./quick-chips";
import { fetchSimilar, similarFromBody } from "./similar";
import type { EventResult, RecommendationSection } from "./types";

const q = (href: string) => Object.fromEntries(new URL(href, "https://x").searchParams);

describe("dateChips", () => {
  // Wed 25 Nov 2026, 20:30 IST
  const now = new Date("2026-11-25T15:00:00Z");

  it("Tonight runs from now to the end of today in IST", () => {
    const [tonight] = dateChips(now);
    expect(tonight!.label).toBe("Tonight");
    expect(q(tonight!.href)).toEqual({
      from: "2026-11-25T15:00:00.000Z",
      to: "2026-11-25T18:29:59.999Z",
    });
  });

  it("This weekend is the coming Fri–Sun in IST", () => {
    expect(q(dateChips(now)[1]!.href)).toEqual({
      from: "2026-11-26T18:30:00.000Z", // Fri 27 Nov 00:00 IST
      to: "2026-11-29T18:29:59.999Z", // Sun 29 Nov 23:59 IST
    });
  });

  it("during the weekend it starts now, not last Friday", () => {
    const saturday = new Date("2026-11-28T10:00:00Z");
    expect(q(dateChips(saturday)[1]!.href).from).toBe("2026-11-28T10:00:00.000Z");
  });

  it("This month runs to the last instant of the IST month", () => {
    expect(q(dateChips(now)[2]!.href)).toEqual({
      from: "2026-11-25T15:00:00.000Z",
      to: "2026-11-30T18:29:59.999Z",
    });
  });
});

describe("cityChips", () => {
  const ev = (id: string, city: string | null): EventResult => ({
    id,
    title: id,
    type: "concert",
    startsAt: "2027-01-01T13:30:00Z",
    startsAtDateOnly: false,
    city,
    venueName: null,
    matchReason: "title",
    matchedText: "",
  });
  const sections: RecommendationSection[] = [
    {
      id: "this_weekend",
      title: "",
      items: [ev("1", "Pune"), ev("2", "Mumbai"), ev("3", "Mumbai")],
    },
    {
      id: "up_next",
      title: "",
      items: [
        ev("2", "Mumbai"),
        ev("4", "Goa"),
        ev("5", null),
        ev("6", "Delhi"),
        ev("7", "Bengaluru"),
      ],
    },
  ];

  it("most shows first, each event counted once, at most 4", () => {
    expect(cityChips(sections, null).map((c) => c.label)).toEqual([
      "Mumbai",
      "Bengaluru",
      "Delhi",
      "Goa",
    ]);
  });

  it("the visitor's city leads, even with no shows in the list", () => {
    expect(cityChips(sections, "Kolkata").map((c) => c.label)).toEqual([
      "Kolkata",
      "Mumbai",
      "Bengaluru",
      "Delhi",
    ]);
    expect(cityChips(sections, "Pune")[0]).toEqual({
      key: "city:Pune",
      emoji: "📍",
      label: "Pune",
      href: "/search?city=Pune",
    });
  });
});

describe("similar shows (client)", () => {
  const body = {
    artists: ["The Chainsmokers"],
    shows: [
      {
        id: "e1",
        title: "Sunburn Arena ft. The Chainsmokers – Bengaluru",
        type: "concert",
        startsAt: "2026-12-12T13:30:00.000Z",
        startsAtDateOnly: false,
        city: "Bengaluru",
        venueName: null,
        artist: "The Chainsmokers",
      },
    ],
  };

  it("maps the route's body to row items", () => {
    expect(similarFromBody(body)).toEqual([
      {
        id: "e1",
        title: "Sunburn Arena ft. The Chainsmokers – Bengaluru",
        startsAt: "2026-12-12T13:30:00.000Z",
        city: "Bengaluru",
        artist: "The Chainsmokers",
      },
    ]);
  });

  it.each([null, {}, { shows: [{ id: 1 }] }, "nope"])("bad body %j → []", (raw) => {
    expect(similarFromBody(raw)).toEqual([]);
  });

  it("asks the route with the artist encoded, and any failure is []", async () => {
    const ok = vi.fn(async () => Response.json(body));
    const signal = new AbortController().signal;
    await expect(fetchSimilar(" Marsh & Mello ", signal, ok)).resolves.toHaveLength(1);
    expect(ok).toHaveBeenCalledWith(
      "/api/search/similar?artist=Marsh%20%26%20Mello",
      expect.objectContaining({ signal }),
    );
    const limited = vi.fn(async () => Response.json({ error: {} }, { status: 429 }));
    await expect(fetchSimilar("x y", signal, limited)).resolves.toEqual([]);
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchSimilar("x y", signal, offline)).resolves.toEqual([]);
  });
});

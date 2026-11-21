import { describe, expect, it } from "vitest";
import {
  artistVisual,
  eventVisual,
  initialsOf,
  lineupLayout,
  nameHash,
  orderForVisuals,
  type VisualArtist,
} from "./visuals";

const a = (name: string, over: Partial<VisualArtist> = {}): VisualArtist => ({
  name,
  imageUrl: null,
  ...over,
});

describe("initialsOf: any name", () => {
  it.each([
    ["Yussef Dayes", "YD"],
    ["When Chai Met Toast", "WC"],
    ["KING", "KING"],
    ["Henge", "HENGE"],
    ["Thievery", "T"],
    ["Salim & Sulaiman", "S&S"],
    ["Anyma x Aeden", "A&A"],
    ["Sunburn ft. DJ Snake", "S&D"],
    ["Vishal and Shekhar", "V&S"],
    ["श्रेया घोषाल", "श्रेघो"],
    ["दिलजीत", "दिलजीत"],
    ["ਦਿਲਜੀਤ ਦੋਸਾਂਝ", "ਦਿਦੋ"],
    ["🔥🔥", "♪"],
    ["DJ 🔥 Chetas", "DC"],
    ["The 1975", "T1"],
    ["Mxrci (Live Set)", "ML"],
  ])("%s → %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe("artistVisual", () => {
  it("Spotify photo, then the alternate photo with its credit from data, then the fallback", () => {
    expect(
      artistVisual(a("A", { imageUrl: "https://s/a.jpg", altImageUrl: "https://w/a" })),
    ).toEqual({ kind: "photo", url: "https://s/a.jpg", credit: null });
    expect(
      artistVisual(a("A", { altImageUrl: "https://w/a.jpg", altImageCredit: "Jo / CC BY-SA 4.0" })),
    ).toEqual({ kind: "photo", url: "https://w/a.jpg", credit: "Jo / CC BY-SA 4.0" });
    expect(artistVisual(a("Yussef Dayes"))).toMatchObject({ kind: "fallback", initials: "YD" });
  });

  it("the fallback is deterministic per name, with two different tones", () => {
    const one = artistVisual(a("Yussef Dayes"));
    expect(artistVisual(a("  yussef dayes "))).toEqual(one);
    expect(nameHash("Yussef Dayes")).toBe(nameHash("yussef dayes"));
    if (one.kind === "fallback") expect(one.from).not.toBe(one.to);
    const tones = new Set(
      ["A", "B", "C", "D", "E", "F", "G", "H"].map((n) => {
        const v = artistVisual(a(n));
        return v.kind === "fallback" ? v.from : "";
      }),
    );
    expect(tones.size).toBeGreaterThan(1);
  });
});

describe("orderForVisuals", () => {
  it("tier, then photo first, then billing rank", () => {
    const out = orderForVisuals([
      a("S", { tier: "support", billingRank: 9, imageUrl: "x" }),
      a("H2", { tier: "headliner", billingRank: 2, imageUrl: "x" }),
      a("H1", { tier: "headliner", billingRank: 1 }),
      a("H3", { tier: "headliner", billingRank: 3, altImageUrl: "y" }),
    ]);
    expect(out.map((x) => x.name)).toEqual(["H2", "H3", "H1", "S"]);
  });
});

describe("eventVisual", () => {
  const head = (name: string, photo: boolean, rank: number) =>
    a(name, { tier: "headliner", billingRank: rank, imageUrl: photo ? `https://i/${name}` : null });

  it("a poster wins", () => {
    expect(
      eventVisual({ posterUrl: "https://p", artists: [head("A", true, 1)], label: "X" }),
    ).toEqual({ kind: "poster", url: "https://p" });
  });
  it("collage: photos first, fallbacks fill, at most 4", () => {
    const plan = eventVisual({
      artists: [
        head("A", false, 1),
        head("B", true, 2),
        head("C", false, 3),
        head("D", true, 4),
        head("E", false, 5),
      ],
      label: "Echoes of Earth",
    });
    expect(plan.kind === "collage" && plan.artists.map((x) => x.name)).toEqual([
      "B",
      "D",
      "A",
      "C",
    ]);
  });
  it("no photos anywhere: a collage of designed fallbacks; no lineup: a branded fallback", () => {
    expect(
      eventVisual({ artists: [head("A", false, 1), head("B", false, 2)], label: "Duo" }),
    ).toMatchObject({ kind: "collage", artists: [{ name: "A" }, { name: "B" }] });
    expect(eventVisual({ artists: [], label: "TBA" })).toMatchObject({
      kind: "fallback",
      label: "TBA",
    });
  });
  it("a top tier without photos borrows from the rest of the lineup", () => {
    const plan = eventVisual({
      artists: [head("A", false, 1), a("S", { tier: "support", billingRank: 2, imageUrl: "x" })],
      label: "Fest",
    });
    expect(plan.kind === "collage" && plan.artists.map((x) => x.name)).toEqual(["A", "S"]);
  });
});

describe("lineupLayout: every lineup size", () => {
  it.each([
    [0, "empty", 0],
    [1, "solo", 1],
    [2, "duo", 2],
    [3, "trio", 3],
    [6, "small", 5],
    [34, "medium", 5],
    [120, "large", 5],
  ] as const)("%i artists → %s", (n, bucket, faces) => {
    const l = lineupLayout(n);
    expect(l.bucket).toBe(bucket);
    expect(l.faceStack).toBe(faces);
  });
  it("small lineups show everyone; big ones cap slides and shrink lower tiers", () => {
    expect(lineupLayout(6).perSlide.support).toBe(8);
    expect(lineupLayout(34).perSlide).toEqual({ headliner: 4, sub: 6, mid: 6, support: 6 });
    expect(lineupLayout(34).size.headliner).toBe("xl");
    expect(lineupLayout(120).size.support).toBe("xs");
  });
});

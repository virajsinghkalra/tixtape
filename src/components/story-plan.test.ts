import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import type { PlaylistPreview } from "./playlist-preview";
import { planStory, type StoryArtist, type StoryInput } from "./story-plan";

const artist = (
  name: string,
  tier: BillingTier,
  billingRank: number,
  imageUrl: string | null = null,
): StoryArtist => ({
  name,
  tier,
  billingRank,
  imageUrl,
});

const input = (artists: StoryArtist[], over: Partial<StoryInput> = {}): StoryInput => ({
  id: "e1",
  title: "Sketchbook by Bhuwin Khursija – Mumbai",
  dateLine: "Sat, 12 Dec 2026",
  city: "Mumbai",
  badge: { emoji: "⏰", label: "21 days to go" },
  artists,
  preview: null,
  playlistHref: "/events/e1#playlist",
  eventHref: "/events/e1",
  days: 1,
  ...over,
});

const soloPreview: PlaylistPreview = {
  songs: 32,
  minutes: 120,
  perTier: [{ tier: "headliner", artists: 1, songs: 32, minutes: 120 }],
  showMinutes: 120,
  days: 1,
  unmatched: 0,
};

describe("planStory: solo (1 artist)", () => {
  const plan = planStory(
    input([artist("Bhuwin", "headliner", 1, "https://i.scdn.co/bhuwin.jpg")], {
      preview: soloPreview,
    }),
  );

  it("is 2 slides: the artist hero, then the playlist", () => {
    expect(plan.slides.map((s) => s.kind)).toEqual(["solo", "playlist"]);
    expect(plan.heading).toBe("The rundown");
  });

  it("the hero carries the artist photo and a smaller title for a long name", () => {
    const hero = plan.slides[0]!;
    expect(hero).toMatchObject({
      kind: "solo",
      artist: { imageUrl: "https://i.scdn.co/bhuwin.jpg" },
      titleSize: "md",
    });
  });

  it("the playlist slide talks about the artist, with no 'openers' and no 'full lineup' link", () => {
    const last = plan.slides[1]!;
    expect(last).toMatchObject({
      kind: "playlist",
      headline: "~32 songs · 2 h of Bhuwin",
      cta: { href: "/events/e1#playlist", text: "Get the playlist" },
      secondary: null,
    });
    expect(JSON.stringify(plan)).not.toMatch(/openers|headliners|1 artists/i);
  });
});

describe("planStory: duo and trio", () => {
  it("duo: intro, the lineup with faces, playlist; the 'full lineup' link shows", () => {
    const plan = planStory(
      input([artist("Anyma", "headliner", 1), artist("Aeden", "support", 2)], {
        title: "Anyma Presents Aeden",
      }),
    );
    expect(plan.slides.map((s) => s.kind)).toEqual(["intro", "names", "playlist"]);
    expect(plan.slides[0]).toMatchObject({ who: "Anyma and Aeden. One night." });
    expect(plan.slides[1]).toMatchObject({ kicker: "🔥 The lineup", faces: true });
    expect(plan.slides[2]).toMatchObject({
      detail: "Headliners first, openers last.",
      secondary: { text: "See the full lineup" },
    });
  });

  it("trio in one tier: billing order, not 'openers last'", () => {
    const plan = planStory(
      input([
        artist("A", "headliner", 1),
        artist("B", "headliner", 2),
        artist("C", "headliner", 3),
      ]),
    );
    expect(plan.slides[0]).toMatchObject({ who: "A, B and C. One night." });
    expect(plan.slides.at(-1)).toMatchObject({ detail: "In billing order." });
  });
});

describe("planStory: festival (many artists)", () => {
  const plan = planStory(
    input(
      [
        artist("Olivia Dean", "headliner", 1),
        artist("Limp Bizkit", "headliner", 2),
        artist("Fontaines D.C.", "sub", 3),
        artist("Ritviz", "support", 4),
      ],
      { title: "Lollapalooza India 2027" },
    ),
  );

  it("keeps the full story, singular where only one artist is in a group", () => {
    expect(plan.slides.map((s) => s.id)).toEqual([
      "intro",
      "headliners",
      "bill",
      "gems",
      "playlist",
    ]);
    expect(plan.slides[1]).toMatchObject({ kicker: "🔥 Top of the bill" });
    expect(plan.slides[3]).toMatchObject({
      kicker: "💎 Catch this one early",
      more: null,
    });
    expect(plan.heading).toBe("The rundown");
  });

  it("a festival with one headliner still reads naturally", () => {
    const one = planStory(
      input([
        artist("A", "headliner", 1),
        artist("B", "sub", 2),
        artist("C", "mid", 3),
        artist("D", "support", 4),
      ]),
    );
    expect(one.slides[1]).toMatchObject({ kicker: "🔥 Top of the bill" });
  });
});

describe("planStory: empty lineup", () => {
  it("is intro + playlist, saying the lineup is coming", () => {
    const plan = planStory(input([]));
    expect(plan.slides.map((s) => s.kind)).toEqual(["intro", "playlist"]);
    expect(plan.slides[0]).toMatchObject({ who: "Lineup drops soon. Watch this space." });
  });
});

describe("planStory: solo without a preview (home story)", () => {
  it("still leads the playlist slide with the artist", () => {
    const plan = planStory(input([artist("Anyma", "headliner", 1, "https://i.scdn.co/a.jpg")]));
    expect(plan.slides[1]).toMatchObject({
      kind: "playlist",
      headline: "Anyma, all night.",
      face: { name: "Anyma" },
      secondary: null,
    });
  });
});

describe("planStory: a 34-act, 2-day festival fits portrait cards", () => {
  const big = Array.from({ length: 34 }, (_, i) =>
    artist(
      `Act ${i + 1}`,
      i < 2 ? "headliner" : i < 12 ? "mid" : "support",
      i + 1,
      i < 3 ? `https://i/${i}.jpg` : null,
    ),
  );
  const plan = planStory(input(big, { title: "HOME Festival 2026", days: 2 }));

  it("never counts slides, and the intro is a cheat sheet with a face stack", () => {
    expect(JSON.stringify(plan.slides)).not.toMatch(/\bslides?\b/i);
    expect(plan.slides[0]).toMatchObject({
      kind: "intro",
      who: "34 acts. 2 days. Here's your cheat sheet.",
    });
    expect(plan.slides[0]!.kind === "intro" && plan.slides[0]!.faces.map((f) => f.name)).toEqual([
      "Act 1",
      "Act 2",
      "Act 3",
    ]);
  });

  it("long tiers show a few names, then '+ N more on the lineup'", () => {
    const bill = plan.slides.find((s) => s.id === "bill");
    const gems = plan.slides.find((s) => s.id === "gems");
    expect(bill).toMatchObject({ more: "+ 4 more on the lineup" });
    expect(bill?.kind === "names" && bill.artists).toHaveLength(6);
    expect(gems).toMatchObject({ more: "+ 16 more on the lineup", faces: false });
  });
});

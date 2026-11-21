import { describe, expect, it } from "vitest";
import type { BillingTier } from "@/domain/shared/lineup";
import { planStory, type SlidePlan, type StoryArtist, type StoryInput } from "./story-plan";

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
  playlistHref: "/events/e1#playlist",
  eventHref: "/events/e1",
  ...over,
});

/** Every visible string on a slide, for the minimal-copy checks (D-082). */
const words = (slides: SlidePlan[]) => JSON.stringify(slides);

describe("planStory: solo (1 artist)", () => {
  const plan = planStory(input([artist("Bhuwin", "headliner", 1, "https://i.scdn.co/bhuwin.jpg")]));

  it("is 2 slides: the artist hero, then the playlist", () => {
    expect(plan.slides.map((s) => s.kind)).toEqual(["solo", "playlist"]);
    expect(plan.heading).toBe("The rundown");
    expect(plan.slides[0]).toMatchObject({
      kind: "solo",
      artist: { imageUrl: "https://i.scdn.co/bhuwin.jpg" },
    });
  });

  it("the playlist slide is a headline and two links: the playlist and the event", () => {
    expect(plan.slides[1]).toMatchObject({
      kind: "playlist",
      headline: "Bhuwin, all night.",
      face: { name: "Bhuwin" },
      cta: { href: "/events/e1#playlist", text: "Open playlist" },
      secondary: { href: "/events/e1", text: "See event" },
    });
  });

  it("on the event page itself there's no 'See event'", () => {
    const here = planStory(
      input([artist("Bhuwin", "headliner", 1)], { playlistHref: "#playlist", eventHref: null }),
    );
    expect(here.slides.at(-1)).toMatchObject({ cta: { href: "#playlist" }, secondary: null });
  });
});

describe("planStory: duo and trio", () => {
  it("duo: intro, the lineup with faces, playlist", () => {
    const plan = planStory(
      input([artist("Anyma", "headliner", 1), artist("Aeden", "support", 2)], {
        title: "Anyma Presents Aeden",
      }),
    );
    expect(plan.slides.map((s) => s.kind)).toEqual(["intro", "names", "playlist"]);
    expect(plan.slides[1]).toMatchObject({ kicker: "🔥 The lineup", faces: true });
    expect(plan.slides[2]).toMatchObject({
      headline: "Every act. One playlist.",
      secondary: { text: "See event" },
    });
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
      { title: "Lollapalooza India 2027", poster: "https://lollaindia.com/p.jpg" },
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
    expect(plan.slides[3]).toMatchObject({ kicker: "💎 Catch this one early", more: null });
  });

  it("the intro carries the official poster", () => {
    expect(plan.slides[0]).toMatchObject({ kind: "intro", poster: "https://lollaindia.com/p.jpg" });
  });
});

describe("planStory: empty lineup", () => {
  it("is intro + playlist", () => {
    const plan = planStory(input([]));
    expect(plan.slides.map((s) => s.kind)).toEqual(["intro", "playlist"]);
  });
});

describe("planStory: a 34-act festival fits portrait cards", () => {
  const big = Array.from({ length: 34 }, (_, i) =>
    artist(
      `Act ${i + 1}`,
      i < 2 ? "headliner" : i < 12 ? "mid" : "support",
      i + 1,
      i < 3 ? `https://i/${i}.jpg` : null,
    ),
  );
  const plan = planStory(input(big, { title: "HOME Festival 2026" }));

  it("the intro has a face stack of the photos it has", () => {
    expect(plan.slides[0]!.kind === "intro" && plan.slides[0]!.faces.map((f) => f.name)).toEqual([
      "Act 1",
      "Act 2",
      "Act 3",
    ]);
  });

  it("long tiers show a few names, then '+ N more'", () => {
    const bill = plan.slides.find((s) => s.id === "bill");
    const gems = plan.slides.find((s) => s.id === "gems");
    expect(bill).toMatchObject({ more: "+ 4 more" });
    expect(bill?.kind === "names" && bill.artists).toHaveLength(6);
    expect(gems).toMatchObject({ more: "+ 16 more", faces: false });
  });
});

describe("minimal copy (D-082)", () => {
  const plans = [
    planStory(input([artist("Bhuwin", "headliner", 1)])),
    planStory(input([artist("A", "headliner", 1), artist("B", "sub", 2)])),
    planStory(
      input(Array.from({ length: 12 }, (_, i) => artist(`A${i}`, i ? "support" : "headliner", i))),
    ),
  ];
  it.each(plans.map((p, i) => [i, p] as const))(
    "story %i: no slide counts, song or minute counts, or Spotify-match commentary",
    (_, plan) => {
      expect(words(plan.slides)).not.toMatch(
        /\bslides?\b|\bsongs?\b|\b\d+ min\b|\d+ h\b|matches the show|openers last|billing order|on spotify|cheat sheet/i,
      );
    },
  );

  it("nothing matched on Spotify yet: 'Playlist soon ⏳', never 0 songs", () => {
    const plan = planStory(input([artist("Shreya Ghoshal", "headliner", 1)], { matched: 0 }));
    expect(plan.slides.at(-1)).toMatchObject({ kind: "playlist", headline: "Playlist soon ⏳" });
    expect(words(plan.slides)).not.toMatch(/\b0 (songs|min)\b/);
  });
});

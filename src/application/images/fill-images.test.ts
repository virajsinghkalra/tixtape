import { describe, expect, it } from "vitest";
import type {
  ArtistImageRow,
  ArtistImageStore,
  EventPosterRow,
  EventPosterStore,
  ImageProvider,
  SavedImage,
} from "@/application/ports/images";
import type { ImageCandidate, ImageSubject } from "@/domain/images/image";
import { asArtistId, asEventId } from "@/domain/shared/ids";
import { fillArtistImages, fillEventPosters, findImage } from "./fill-images";

const NOW = new Date("2026-11-22T10:00:00Z");
const clock = { now: () => NOW };

const commons = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/X.jpg/500px-X.jpg",
  credit: "Photo: A, CC BY-SA 4.0, Wikimedia Commons",
  license: "CC BY-SA 4.0",
  source: "wikimedia",
  confidence: 0.8,
  evidence: ["Q1"],
  ...over,
});

function provider(
  id: string,
  answer: ImageCandidate | null | Error,
  kinds: ImageSubject["kind"][] = ["artist", "event"],
): ImageProvider & { calls: number } {
  return {
    id,
    calls: 0,
    supports: (s) => kinds.includes(s.kind),
    async find() {
      this.calls += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const artistSubject: ImageSubject = {
  kind: "artist",
  name: "Yussef Dayes",
  spotifyId: null,
  mbid: null,
  spotifyImageUrl: null,
};

describe("findImage", () => {
  it("asks providers in order and keeps the policy's pick", async () => {
    const result = await findImage([provider("a", null), provider("b", commons())], artistSubject);
    expect(result.chosen?.source).toBe("wikimedia");
    expect(result.tried.map((t) => t.provider)).toEqual(["a", "b"]);
  });

  it("records refused candidates with the reason", async () => {
    const nc = commons({ license: "CC BY-NC 4.0" });
    const result = await findImage([provider("w", nc)], artistSubject);
    expect(result.chosen).toBeNull();
    expect(result.tried).toEqual([
      { provider: "w", candidate: nc, refused: "licence not free: CC BY-NC 4.0" },
    ]);
  });

  it("skips a failing provider and carries on", async () => {
    const result = await findImage(
      [provider("down", new Error("HTTP 503")), provider("w", commons())],
      artistSubject,
    );
    expect(result.chosen).not.toBeNull();
    expect(result.tried[0]).toEqual({
      provider: "down",
      candidate: null,
      refused: "error: HTTP 503",
    });
  });

  it("stops early when the most trusted source has an acceptable picture", async () => {
    const spotify = provider(
      "spotify",
      commons({ source: "spotify", license: null, url: "https://i.scdn.co/image/x" }),
    );
    const wikimedia = provider("wikimedia", commons());
    const result = await findImage([spotify, wikimedia], artistSubject);
    expect(result.chosen?.source).toBe("spotify");
    expect(wikimedia.calls).toBe(0);
  });

  it("only asks providers that support the subject", async () => {
    const eventsOnly = provider("official", commons(), ["event"]);
    await findImage([eventsOnly], artistSubject);
    expect(eventsOnly.calls).toBe(0);
  });
});

class FakeArtistStore implements ArtistImageStore {
  saved: { id: string; image: SavedImage | null; at: Date }[] = [];
  touched: string[] = [];
  constructor(private readonly rows: ArtistImageRow[]) {}
  async listDue(_before: Date, limit: number) {
    return this.rows.slice(0, limit);
  }
  async save(id: string, image: SavedImage | null, at: Date) {
    this.saved.push({ id, image, at });
  }
  async touch(id: string) {
    this.touched.push(id);
  }
}

const row = (name: string, alt: ArtistImageRow["alt"] = null): ArtistImageRow => ({
  id: asArtistId(name.toLowerCase().replace(/ /gu, "-")),
  name,
  spotifyId: null,
  mbid: null,
  spotifyImageUrl: null,
  alt,
});

describe("fillArtistImages", () => {
  const brokenUrl = "https://upload.wikimedia.org/broken.jpg";
  const links = { isBroken: async (url: string) => url === brokenUrl };

  it.each([
    ["no picture yet, one found", null, commons(), "set"],
    ["no picture yet, none found", null, null, "none"],
    [
      "a working picture",
      { url: "https://upload.wikimedia.org/ok.jpg", source: "wikimedia" },
      commons(),
      "kept",
    ],
    [
      "a broken picture, a new one found",
      { url: brokenUrl, source: "wikimedia" },
      commons(),
      "set",
    ],
    ["a broken picture, nothing found", { url: brokenUrl, source: "official" }, null, "cleared"],
  ] as const)("%s → %s", async (_label, alt, answer, action) => {
    const store = new FakeArtistStore([row("Yussef Dayes", alt)]);
    const [outcome] = await fillArtistImages(
      { providers: [provider("w", answer)], links, clock, store },
      { limit: 10, dryRun: false },
    );
    expect(outcome?.action).toBe(action);
    if (action === "kept") {
      expect(store.touched).toEqual(["yussef-dayes"]);
      expect(store.saved).toEqual([]);
    } else {
      expect(store.saved).toEqual([
        {
          id: "yussef-dayes",
          image:
            action === "set"
              ? { url: commons().url, credit: commons().credit, source: "wikimedia" }
              : null,
          at: NOW,
        },
      ]);
    }
  });

  it("writes nothing when a provider failed and nothing was found, so it is retried", async () => {
    const store = new FakeArtistStore([row("Mali")]);
    const [outcome] = await fillArtistImages(
      { providers: [provider("w", new Error("timeout"))], links, clock, store },
      { limit: 10, dryRun: false },
    );
    expect(outcome?.action).toBe("failed");
    expect(store.saved).toEqual([]);
    expect(store.touched).toEqual([]);
  });

  it("still saves a picture another provider found despite a failure", async () => {
    const store = new FakeArtistStore([row("Mali")]);
    const [outcome] = await fillArtistImages(
      {
        providers: [provider("down", new Error("timeout")), provider("w", commons())],
        links,
        clock,
        store,
      },
      { limit: 10, dryRun: false },
    );
    expect(outcome?.action).toBe("set");
    expect(store.saved).toHaveLength(1);
  });

  it("writes nothing in a dry run", async () => {
    const store = new FakeArtistStore([row("Yussef Dayes")]);
    const outcomes = await fillArtistImages(
      { providers: [provider("w", commons())], links, clock, store },
      { limit: 10, dryRun: true },
    );
    expect(outcomes[0]?.action).toBe("set");
    expect(store.saved).toEqual([]);
  });

  it("honours the limit", async () => {
    const store = new FakeArtistStore([row("A1"), row("B2"), row("C3")]);
    const outcomes = await fillArtistImages(
      { providers: [provider("w", null)], links, clock, store },
      { limit: 2, dryRun: false },
    );
    expect(outcomes).toHaveLength(2);
  });

  it("passes the artist's identity to providers", async () => {
    let seen: ImageSubject | null = null;
    const spy: ImageProvider = {
      id: "spy",
      supports: () => true,
      find: async (s) => {
        seen = s;
        return null;
      },
    };
    const store = new FakeArtistStore([
      { ...row("Shreya Ghoshal"), spotifyId: "0oOet2f43PA68X5RxKobEy", mbid: "mb" },
    ]);
    await fillArtistImages({ providers: [spy], links, clock, store }, { limit: 1, dryRun: true });
    expect(seen).toEqual({
      kind: "artist",
      name: "Shreya Ghoshal",
      spotifyId: "0oOet2f43PA68X5RxKobEy",
      mbid: "mb",
      spotifyImageUrl: null,
    });
  });
});

describe("fillEventPosters", () => {
  it("sends the event's official pages to providers and stores the poster", async () => {
    let seen: ImageSubject | null = null;
    const official: ImageProvider = {
      id: "official",
      supports: (s) => s.kind === "event",
      find: async (s) => {
        seen = s;
        return commons({
          source: "official",
          license: null,
          url: "https://sunburn.in/p.jpg",
          credit: "Poster: sunburn.in",
        });
      },
    };
    const saved: unknown[] = [];
    const rows: EventPosterRow[] = [
      {
        id: asEventId("e1"),
        title: "Sunburn 2026",
        officialUrls: ["https://sunburn.in/event"],
        poster: null,
      },
    ];
    const store: EventPosterStore = {
      listDue: async () => rows,
      save: async (id, image) => {
        saved.push({ id, image });
      },
      touch: async () => {},
    };
    await fillEventPosters(
      { providers: [official], links: { isBroken: async () => false }, clock, store },
      { limit: 5, dryRun: false },
    );
    expect(seen).toEqual({
      kind: "event",
      title: "Sunburn 2026",
      officialUrls: ["https://sunburn.in/event"],
    });
    expect(saved).toEqual([
      {
        id: "e1",
        image: {
          url: "https://sunburn.in/p.jpg",
          credit: "Poster: sunburn.in",
          source: "official",
        },
      },
    ]);
  });
});

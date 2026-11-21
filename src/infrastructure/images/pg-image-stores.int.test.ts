import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { artists, eventSources, events } from "@/db/schema";
import { asArtistId, asEventId } from "@/domain/shared/ids";
import { truncateEventTables } from "@/infrastructure/db/events-test-db";
import { testDb } from "../../../tests/setup/db";
import { PgArtistImageStore, PgEventPosterStore } from "./pg-image-stores";

const db = testDb();
const NOW = new Date("2026-11-22T10:00:00Z");
const BEFORE = new Date("2026-10-23T10:00:00Z"); // 30 days earlier

beforeEach(async () => {
  await truncateEventTables(db);
});
afterAll(async () => {
  await db.$close();
});

async function artist(name: string, over: Partial<typeof artists.$inferInsert> = {}) {
  const [row] = await db
    .insert(artists)
    .values({ name, normalizedName: name.toLowerCase(), ...over })
    .returning({ id: artists.id });
  return asArtistId(row!.id);
}

describe("PgArtistImageStore", () => {
  const store = new PgArtistImageStore(db);

  it("lists artists without a Spotify image whose check is due, oldest first", async () => {
    const never = await artist("Never Checked");
    const stale = await artist("Stale", { altImageCheckedAt: new Date("2026-09-01T00:00:00Z") });
    await artist("Fresh", { altImageCheckedAt: new Date("2026-11-20T00:00:00Z") });
    await artist("Has Spotify Image", { imageUrl: "https://i.scdn.co/image/x" });
    const withAlt = await artist("With Alt", {
      altImageUrl: "https://upload.wikimedia.org/a.jpg",
      altImageSource: "wikimedia",
      altImageCheckedAt: new Date("2026-08-01T00:00:00Z"),
    });
    const due = await store.listDue(BEFORE, 10);
    expect(due.map((r) => r.id)).toEqual([never, withAlt, stale]);
    expect(due[1]?.alt).toEqual({ url: "https://upload.wikimedia.org/a.jpg", source: "wikimedia" });
    expect(await store.listDue(BEFORE, 1)).toHaveLength(1);
  });

  it("saves, clears and touches without changing the Spotify image", async () => {
    const id = await artist("Yussef Dayes", { spotifyId: "sp", mbid: "mb" });
    const image = {
      url: "https://upload.wikimedia.org/y.jpg",
      credit: "Photo: A, CC0",
      source: "wikimedia",
    };
    await store.save(id, image, NOW);
    const read = async () => (await db.select().from(artists).where(eq(artists.id, id)))[0];
    expect(await read()).toMatchObject({
      altImageUrl: image.url,
      altImageCredit: image.credit,
      altImageSource: "wikimedia",
      altImageCheckedAt: NOW,
      imageUrl: null,
      spotifyId: "sp",
    });
    const later = new Date("2026-12-22T10:00:00Z");
    await store.touch(id, later);
    expect(await read()).toMatchObject({ altImageUrl: image.url, altImageCheckedAt: later });
    await store.save(id, null, later);
    expect(await read()).toMatchObject({
      altImageUrl: null,
      altImageCredit: null,
      altImageSource: null,
    });
  });

  it("passes identity fields to the pipeline", async () => {
    const id = await artist("Shreya Ghoshal", {
      spotifyId: "0oOet2f43PA68X5RxKobEy",
      mbid: "mb-1",
    });
    expect(await store.listDue(BEFORE, 5)).toEqual([
      {
        id,
        name: "Shreya Ghoshal",
        spotifyId: "0oOet2f43PA68X5RxKobEy",
        mbid: "mb-1",
        spotifyImageUrl: null,
        alt: null,
      },
    ]);
  });
});

describe("PgEventPosterStore", () => {
  const store = new PgEventPosterStore(db);
  const future = new Date(Date.now() + 30 * 86_400_000);

  async function event(
    title: string,
    over: Partial<typeof events.$inferInsert> = {},
    urls: string[] = [],
  ) {
    const [row] = await db
      .insert(events)
      .values({
        title,
        type: "festival",
        startsAt: future,
        visibility: "published",
        dedupeKey: title,
        ...over,
      })
      .returning({ id: events.id });
    const id = row!.id;
    for (const [i, url] of urls.entries()) {
      await db
        .insert(eventSources)
        .values({ eventId: id, source: "admin", externalId: `${title}-${i}`, url });
    }
    return asEventId(id);
  }

  it("lists upcoming published events that are due, with their source pages", async () => {
    const sunburn = await event("Sunburn", {}, [
      "https://www.sunburn.in/event",
      "https://in.bookmyshow.com/x",
    ]);
    await event("Held", { visibility: "held" });
    await event("Past", { startsAt: new Date("2020-01-01T00:00:00Z") });
    await event("Fresh", { posterCheckedAt: new Date(Date.now() - 86_400_000) });
    const due = await store.listDue(new Date(Date.now() - 30 * 86_400_000), 10);
    expect(due).toEqual([
      {
        id: sunburn,
        title: "Sunburn",
        officialUrls: ["https://www.sunburn.in/event", "https://in.bookmyshow.com/x"],
        poster: null,
      },
    ]);
  });

  it("saves the poster with its credit and source, and touches", async () => {
    const id = await event("Sunburn", { imageUrl: "https://ingest/x.jpg" });
    await store.save(
      id,
      { url: "https://cdn/p.jpg", credit: "Poster: sunburn.in", source: "official" },
      NOW,
    );
    const read = async () => (await db.select().from(events).where(eq(events.id, id)))[0];
    expect(await read()).toMatchObject({
      posterUrl: "https://cdn/p.jpg",
      posterCredit: "Poster: sunburn.in",
      posterSource: "official",
      posterCheckedAt: NOW,
      imageUrl: "https://ingest/x.jpg",
    });
    const later = new Date("2026-12-01T00:00:00Z");
    await store.touch(id, later);
    expect(await read()).toMatchObject({ posterUrl: "https://cdn/p.jpg", posterCheckedAt: later });
  });
});

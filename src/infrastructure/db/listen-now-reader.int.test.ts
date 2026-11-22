import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { artists, eventArtists, events, sharedPlaylists } from "@/db/schema";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { readListenNow } from "./listen-now-reader";

const db = testDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

async function event(key: string, title: string, artistIds: string[], visibility = "published") {
  const [e] = await db
    .insert(events)
    .values({
      title,
      type: "concert",
      startsAt: new Date("2027-01-01T00:00:00Z"),
      dedupeKey: key,
      visibility: visibility as "published",
    })
    .returning({ id: events.id });
  await db.insert(eventArtists).values(
    artistIds.map((artistId, i) => ({
      eventId: e!.id,
      artistId,
      billingRank: i + 1,
      tier: "headliner" as const,
    })),
  );
  return e!.id;
}

describe("readListenNow", () => {
  it("returns the sibling's playlist, else every top artist (page or search), and 404s unpublished", async () => {
    const rows = await db
      .insert(artists)
      .values([
        { name: "A", normalizedName: "a", spotifyId: "sa" },
        { name: "B", normalizedName: "b" },
      ])
      .returning({ id: artists.id });
    const [a, b] = [rows[0]!.id, rows[1]!.id];
    const mine = await event("m", "Tour – Pune", [a, b]);
    const hidden = await event("h", "Hidden", [a], "held");

    const before = await readListenNow(db, mine, new Date());
    // An artist without a Spotify id still gets a playable search link (never an empty list).
    expect(before).toEqual({
      artists: [
        { name: "A", spotifyId: "sa", url: "https://open.spotify.com/artist/sa" },
        { name: "B", spotifyId: null, url: "https://open.spotify.com/search/B" },
      ],
    });
    expect(await readListenNow(db, hidden, new Date())).toBeNull();

    const sib = await event("s", "Tour – Delhi", [b, a]);
    await event("o", "Tour – Goa", [a]); // different headliner set
    await db.insert(sharedPlaylists).values({
      eventId: sib,
      spotifyPlaylistId: "pl",
      url: "https://open.spotify.com/playlist/pl",
      trackIds: ["t1"],
    });
    expect(await readListenNow(db, mine, new Date())).toEqual({
      sibling: { url: "https://open.spotify.com/playlist/pl", title: "Tour" },
      artists: [],
    });
  });
});

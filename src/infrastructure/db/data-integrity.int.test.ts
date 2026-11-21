/** P1.10: artist and event merges, review rows, candidate persistence, natural-key guards. */
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  artistAliases,
  artistMatchCandidates,
  artists,
  artistTrackCache,
  eventArtists,
  eventMergeReviews,
  events,
  eventSources,
  eventStats,
  playlists,
  sharedPlaylists,
  users,
  venueAliases,
  venues,
} from "@/db/schema";
import type { ScoredCandidate } from "@/domain/matching/score";
import { asArtistId, asEventId, asSpotifyArtistId, type EventId } from "@/domain/shared/ids";
import type { BillingTier, EventSource } from "@/domain/shared/lineup";
import { ValidationError } from "@/lib/errors";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgArtistRepository } from "./artist-repository";
import { PgEventRepository } from "./event-repository";
import { PgMatchCandidateStore } from "./match-candidate-store";

const db = testDb();
const artistRepo = new PgArtistRepository(db);
const eventRepo = new PgEventRepository(db);
afterAll(() => db.$close());
beforeEach(() => truncateAll(db));

const sp = asSpotifyArtistId;

async function artist(name: string, extra: Partial<typeof artists.$inferInsert> = {}) {
  const rows = await db
    .insert(artists)
    .values({ name, normalizedName: name.toLowerCase(), ...extra })
    .returning();
  return asArtistId(rows[0]!.id);
}

async function venue(): Promise<string> {
  await db
    .insert(venues)
    .values({ name: "NSCI Dome", normalizedName: "nsci dome", city: "Mumbai", country: "IN" })
    .onConflictDoNothing();
  return (await db.select().from(venues).where(eq(venues.normalizedName, "nsci dome")))[0]!.id;
}

async function event(
  title: string,
  opts: { source?: EventSource; genre?: string | null; startsAt?: string } = {},
): Promise<EventId> {
  const venueId = await venue();
  const rows = await db
    .insert(events)
    .values({
      title,
      type: "concert",
      venueId,
      startsAt: new Date(opts.startsAt ?? "2027-02-01T14:00:00Z"),
      genre: opts.genre ?? null,
      dedupeKey: `${title.toLowerCase()}|2027-02-01|mumbai`,
      visibility: "published",
    })
    .returning();
  const id = asEventId(rows[0]!.id);
  await db
    .insert(eventSources)
    .values({ eventId: id, source: opts.source ?? "ticketmaster", externalId: `ext-${title}` });
  return id;
}

async function lineup(eventId: EventId, artistId: string, billingRank: number, tier: BillingTier) {
  await db.insert(eventArtists).values({ eventId, artistId, billingRank, tier });
}

describe("ArtistMerge", () => {
  it("finds an artist by Spotify ID", async () => {
    const id = await artist("Ritviz", { spotifyId: "sp-ritviz", matchStatus: "auto" });
    expect((await artistRepo.findBySpotifyId(sp("sp-ritviz")))?.id).toBe(id);
    expect(await artistRepo.findBySpotifyId(sp("nobody"))).toBeNull();
  });

  it("moves lineup rows and aliases, keeps the higher billing on shared events, deletes the duplicate", async () => {
    const canon = await artist("Nucleya", { spotifyId: "sp-nuc", matchStatus: "auto" });
    const dup = await artist("Nucleya Live");
    const shared = await event("Bass Night");
    const onlyDup = await event("Sunburn Arena");
    await lineup(shared, canon, 3, "mid");
    await lineup(shared, dup, 1, "headliner");
    await lineup(onlyDup, dup, 2, "sub");
    await db.insert(artistAliases).values({ artistId: dup, aliasNormalized: "nucleya dj" });

    const outcome = await artistRepo.mergeInto(dup, canon);

    expect(outcome).toEqual({
      kind: "merged",
      lineupRowsMoved: 1,
      lineupRowsCollapsed: 1,
      aliasesMoved: 1,
      trackCacheRowsMoved: 0,
    });
    expect(await artistRepo.findById(dup)).toBeNull();
    const rows = await db.select().from(eventArtists);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.artistId === canon)).toBe(true);
    expect(rows.find((r) => r.eventId === shared)).toMatchObject({
      billingRank: 1,
      tier: "headliner",
    });
    // Both the moved alias and the duplicate's own name now lead to the canonical artist.
    expect((await artistRepo.findByAlias("nucleya dj"))?.id).toBe(canon);
    expect((await artistRepo.findOrCreateByName("Nucleya Live", "nucleya live")).id).toBe(canon);
  });

  it("inherits the duplicate's Spotify match and track cache when the canonical has none", async () => {
    const canon = await artist("Prateek Kuhad");
    const dup = await artist("Prateek Kuhad.", {
      spotifyId: "sp-pk",
      matchStatus: "auto",
      matchScore: 95,
    });
    await db.insert(artistTrackCache).values([
      { artistId: dup, mode: "hits", market: "IN", spotifyTrackIds: ["t1", "t2"] },
      { artistId: canon, mode: "hits", market: "IN", spotifyTrackIds: ["stale"] },
    ]);

    const outcome = await artistRepo.mergeInto(dup, canon);

    expect(outcome).toMatchObject({ kind: "merged", trackCacheRowsMoved: 1 });
    expect(await artistRepo.findById(canon)).toMatchObject({
      spotifyId: "sp-pk",
      matchStatus: "auto",
      matchScore: 95,
    });
    const cache = await db.select().from(artistTrackCache);
    expect(cache).toEqual([
      expect.objectContaining({ artistId: canon, spotifyTrackIds: ["t1", "t2"] }),
    ]);
  });

  it("refuses to merge two different Spotify artists, or over a manual decision, and changes nothing", async () => {
    const a = await artist("Divine", { spotifyId: "sp-1", matchStatus: "auto" });
    const b = await artist("Divine (rapper)", { spotifyId: "sp-2", matchStatus: "auto" });
    const manual = await artist("Divine Tribe", { matchStatus: "manual" });
    const e = await event("Gully Gig");
    await lineup(e, b, 1, "headliner");

    expect(await artistRepo.mergeInto(b, a)).toEqual({
      kind: "spotify_conflict",
      duplicateSpotifyId: "sp-2",
      canonicalSpotifyId: "sp-1",
    });
    expect((await artistRepo.mergeInto(b, manual)).kind).toBe("spotify_conflict");
    expect(await artistRepo.findById(b)).not.toBeNull();
    expect((await db.select().from(eventArtists))[0]?.artistId).toBe(b);
  });

  it("reports missing artists and rejects merging an artist into itself", async () => {
    const a = await artist("Ritviz");
    const ghost = asArtistId("00000000-0000-0000-0000-000000000000");
    expect(await artistRepo.mergeInto(ghost, a)).toEqual({ kind: "not_found", missing: [ghost] });
    await expect(artistRepo.mergeInto(a, a)).rejects.toThrow(ValidationError);
  });
});

describe("EventMerge", () => {
  it("records a possible duplicate once, keeping the latest score", async () => {
    const a = await event("Lolla Day 1");
    const b = await event("Lollapalooza Day 1");
    await eventRepo.recordMergeReview(b, a, 0.7);
    await eventRepo.recordMergeReview(b, a, 0.75);
    expect(await eventRepo.listMergeReviews(10)).toEqual([
      expect.objectContaining({ eventId: b, similarTo: a, score: 0.75 }),
    ]);
  });

  it("moves sources, lineup, playlists and stats; the higher-precedence source's fields win", async () => {
    const x = await artist("X");
    const y = await artist("Y");
    const canon = await event("Show", { source: "rollingstone", genre: "Pop" });
    const dup = await event("Show Live", { source: "admin" });
    await lineup(canon, x, 1, "headliner");
    await lineup(dup, y, 1, "headliner");
    await db.update(events).set({ lineupHash: "h-canon" }).where(eq(events.id, canon));
    await db.update(events).set({ lineupHash: "h-dup" }).where(eq(events.id, dup));
    await db.insert(sharedPlaylists).values({
      eventId: dup,
      spotifyPlaylistId: "pl-dup",
      url: "https://open.spotify.com/playlist/pl-dup",
      trackIds: [],
    });
    const user = (await db.insert(users).values({ spotifyUserId: "u1" }).returning())[0]!;
    await db.insert(playlists).values({
      userId: user.id,
      eventId: dup,
      optionsHash: "o1",
      spotifyPlaylistId: "pp1",
      trackIds: [],
    });
    await db.insert(eventStats).values([
      { eventId: canon, views: 3 },
      { eventId: dup, views: 4 },
    ]);
    const third = await event("Other");
    await eventRepo.recordMergeReview(dup, canon, 0.7);
    await eventRepo.recordMergeReview(third, dup, 0.65);

    const outcome = await eventRepo.mergeEvents(dup, canon);

    expect(outcome).toEqual({
      kind: "merged",
      duplicateFieldsWon: true,
      sourcesMoved: 1,
      sharedPlaylistMoved: true,
      personalPlaylistsMoved: 1,
    });
    expect(await eventRepo.findById(dup)).toBeNull();
    const merged = await eventRepo.findById(canon);
    // Admin outranks Rolling Stone (D-026), but its null genre doesn't blank the canonical's.
    expect(merged).toMatchObject({ title: "Show Live", genre: "Pop", lineupHash: "h-dup" });
    expect(merged?.sources.sort()).toEqual(["admin", "rollingstone"]);
    expect(merged?.dedupeKey).toBe("show live|2027-02-01|mumbai");
    expect((await db.select().from(eventArtists)).map((r) => r.artistId)).toEqual([y]);
    expect((await db.select().from(sharedPlaylists))[0]?.eventId).toBe(canon);
    expect((await db.select().from(playlists))[0]?.eventId).toBe(canon);
    expect((await db.select().from(eventStats))[0]).toMatchObject({ eventId: canon, views: 7 });
    expect(await eventRepo.listMergeReviews(10)).toEqual([
      expect.objectContaining({ eventId: third, similarTo: canon }),
    ]);
  });

  it("keeps the canonical's fields and lineup on a precedence tie", async () => {
    const x = await artist("X");
    const canon = await event("Keep Me");
    const dup = await event("Drop Me");
    await lineup(canon, x, 1, "headliner");
    await db.update(events).set({ lineupHash: "h-canon" }).where(eq(events.id, canon));
    await db.update(events).set({ lineupHash: "h-dup" }).where(eq(events.id, dup));

    expect(await eventRepo.mergeEvents(dup, canon)).toMatchObject({ duplicateFieldsWon: false });
    expect(await eventRepo.findById(canon)).toMatchObject({
      title: "Keep Me",
      lineupHash: "h-canon",
    });
  });

  it("refuses when both events have a shared playlist, changing nothing", async () => {
    const a = await event("A");
    const b = await event("B");
    for (const [id, pl] of [
      [a, "pl-a"],
      [b, "pl-b"],
    ] as const) {
      await db
        .insert(sharedPlaylists)
        .values({ eventId: id, spotifyPlaylistId: pl, url: pl, trackIds: [] });
    }
    expect(await eventRepo.mergeEvents(b, a)).toEqual({ kind: "both_have_shared_playlist" });
    expect(await eventRepo.findById(b)).not.toBeNull();
    expect(await db.select().from(sharedPlaylists)).toHaveLength(2);
  });

  it("refuses when one user has the same personal playlist on both events", async () => {
    const a = await event("A");
    const b = await event("B");
    const user = (await db.insert(users).values({ spotifyUserId: "u1" }).returning())[0]!;
    await db.insert(playlists).values([
      { userId: user.id, eventId: a, optionsHash: "o", spotifyPlaylistId: "p1", trackIds: [] },
      { userId: user.id, eventId: b, optionsHash: "o", spotifyPlaylistId: "p2", trackIds: [] },
    ]);
    expect(await eventRepo.mergeEvents(b, a)).toEqual({
      kind: "personal_playlist_conflict",
      userIds: [user.id],
    });
  });

  it("reports missing events and rejects merging an event into itself", async () => {
    const a = await event("A");
    const ghost = asEventId("00000000-0000-0000-0000-000000000000");
    expect(await eventRepo.mergeEvents(a, ghost)).toEqual({ kind: "not_found", missing: [ghost] });
    await expect(eventRepo.mergeEvents(a, a)).rejects.toThrow(ValidationError);
  });
});

describe("PgMatchCandidateStore", () => {
  const scored = (id: string, score: number): ScoredCandidate => ({
    candidate: { id: sp(id), name: "Ritviz", rank: 0, imageUrl: null, genres: ["indian edm"] },
    score,
    breakdown: {
      nameMatchKind: "exact",
      nameMatch: 50,
      rank: 15,
      image: 0,
      genre: 10,
      externalId: 0,
      songOwnership: 0,
    },
  });
  const store = new PgMatchCandidateStore(db, { now: () => new Date("2026-11-21T00:00:00Z") });

  it("saves, replaces, reads back and deletes candidates, surviving a new store instance", async () => {
    const a = await artist("Ritviz");
    expect(await store.get(a)).toBeNull();
    await store.save(a, [scored("s1", 70)]);
    await store.save(a, [scored("s2", 80), scored("s3", 60)]);
    const fresh = new PgMatchCandidateStore(db, { now: () => new Date() });
    expect(await fresh.get(a)).toEqual([scored("s2", 80), scored("s3", 60)]);
    await fresh.delete(a);
    expect(await store.get(a)).toBeNull();
  });

  it("treats a malformed stored row as missing", async () => {
    const a = await artist("Ritviz");
    await db.insert(artistMatchCandidates).values({ artistId: a, candidates: [{ nope: 1 }] });
    expect(await store.get(a)).toBeNull();
  });
});

describe("natural keys reject duplicates (ENGINEERING.md §10.1)", () => {
  const rejects = (p: Promise<unknown>) =>
    expect(p).rejects.toMatchObject({ cause: { code: "23505" } });

  it("artists.spotify_id", async () => {
    await artist("A", { spotifyId: "same" });
    await rejects(artist("B", { spotifyId: "same" }));
  });

  it("artist and venue aliases are globally unique", async () => {
    const a = await artist("A");
    const b = await artist("B");
    await db.insert(artistAliases).values({ artistId: a, aliasNormalized: "x" });
    await rejects(db.insert(artistAliases).values({ artistId: b, aliasNormalized: "x" }));
    const [v1, v2] = await db
      .insert(venues)
      .values([
        { name: "V1", normalizedName: "v1", city: "Mumbai", country: "IN" },
        { name: "V2", normalizedName: "v2", city: "Delhi", country: "IN" },
      ])
      .returning();
    await db.insert(venueAliases).values({ venueId: v1!.id, aliasNormalized: "the dome" });
    await rejects(db.insert(venueAliases).values({ venueId: v2!.id, aliasNormalized: "the dome" }));
  });

  it("venue (normalized name, city), event dedupe key, source ref, lineup pair", async () => {
    await event("Dup");
    await rejects(
      db
        .insert(venues)
        .values({ name: "NSCI", normalizedName: "nsci dome", city: "Mumbai", country: "IN" }),
    );
    await rejects(
      db.insert(events).values({
        title: "Dup",
        type: "concert",
        startsAt: new Date(),
        dedupeKey: "dup|2027-02-01|mumbai",
      }),
    );
    const other = await event("Other");
    await rejects(
      db
        .insert(eventSources)
        .values({ eventId: other, source: "ticketmaster", externalId: "ext-Dup" }),
    );
    const x = await artist("X");
    await lineup(other, x, 1, "headliner");
    await rejects(lineup(other, x, 2, "sub"));
  });

  it("event_merge_reviews rejects a self-pair", async () => {
    const a = await event("A");
    await expect(
      db.insert(eventMergeReviews).values({ eventId: a, similarTo: a, score: 0.7 }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

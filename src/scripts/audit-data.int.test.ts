/** P1.10 audit: finds every kind of mess on a seeded DB; `--fix` touches only the safe ones. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  artistAliases,
  artistMatchCandidates,
  artists,
  eventArtists,
  eventCandidates,
  eventMergeReviews,
  events,
  sharedPlaylists,
  venues,
} from "@/db/schema";
import { testDb, truncateAll } from "../../tests/setup/db";
import { applySafeFixes, auditData, type AuditReport } from "./audit-data";

const db = testDb();
afterAll(() => db.$close());
beforeEach(() => truncateAll(db));

const now = new Date("2026-11-21T00:00:00Z");
const old = new Date("2026-09-01T00:00:00Z");

async function seedMess() {
  const [used, orphanVenue] = await db
    .insert(venues)
    .values([
      { name: "NSCI Dome", normalizedName: "nsci dome", city: "Mumbai", country: "IN" },
      { name: "Venue TBA", normalizedName: "venue tba", city: "Goa", country: "IN" },
    ])
    .returning();
  const [ritviz, ritviz2, orphan, manualOrphan, settled, alias] = await db
    .insert(artists)
    .values([
      { name: "Ritviz", normalizedName: "ritviz", spotifyId: "sp-r", matchStatus: "auto" },
      { name: "RITVIZ", normalizedName: "ritviz" },
      { name: "Nobody", normalizedName: "nobody" },
      { name: "Admin Kept", normalizedName: "admin kept", matchStatus: "manual" },
      { name: "Settled", normalizedName: "settled", matchStatus: "auto", spotifyId: "sp-s" },
      { name: "Shadowed", normalizedName: "shadowed" },
    ])
    .returning();
  await db.insert(artistAliases).values({ artistId: ritviz!.id, aliasNormalized: "shadowed" });
  const ev = (title: string, key: string, startsAt: string, visibility: "held" | "published") => ({
    title,
    type: "concert" as const,
    venueId: used!.id,
    startsAt: new Date(startsAt),
    dedupeKey: key,
    visibility,
  });
  const [future, nearDup, past, noHeadliner, held] = await db
    .insert(events)
    .values([
      ev("Ritviz Live", "ritviz live|2027-01-10|mumbai", "2027-01-10T14:00:00Z", "published"),
      ev("Ritviz Live", "ritviz live|2027-01-11|mumbai", "2027-01-11T14:00:00Z", "held"),
      ev("Old Show", "old show|2026-10-01|mumbai", "2026-10-01T14:00:00Z", "published"),
      ev("Support Only", "support only|2027-03-01|mumbai", "2027-03-01T14:00:00Z", "published"),
      ev("Held Show", "held show|2027-04-01|mumbai", "2027-04-01T14:00:00Z", "held"),
    ])
    .returning();
  await db.insert(eventArtists).values([
    { eventId: future!.id, artistId: ritviz!.id, billingRank: 1, tier: "headliner" },
    { eventId: nearDup!.id, artistId: ritviz2!.id, billingRank: 1, tier: "headliner" },
    { eventId: past!.id, artistId: settled!.id, billingRank: 1, tier: "headliner" },
    { eventId: noHeadliner!.id, artistId: alias!.id, billingRank: 1, tier: "support" },
  ]);
  await db
    .insert(eventMergeReviews)
    .values({ eventId: nearDup!.id, similarTo: future!.id, score: 0.7 });
  await db.insert(sharedPlaylists).values({
    eventId: held!.id,
    spotifyPlaylistId: "pl-held",
    url: "https://open.spotify.com/playlist/pl-held",
    trackIds: [],
  });
  await db.insert(eventCandidates).values([
    { dedupeKey: "a|b|c", source: "pollstar", externalId: "old", payload: {}, lastSeenAt: old },
    { dedupeKey: "a|b|c", source: "pollstar", externalId: "new", payload: {}, lastSeenAt: now },
  ]);
  await db.insert(artistMatchCandidates).values([
    { artistId: settled!.id, candidates: [], scoredAt: old },
    { artistId: ritviz2!.id, candidates: [], scoredAt: now },
  ]);
  return { orphanVenue, orphan, manualOrphan, past, noHeadliner };
}

const counts = (r: AuditReport) =>
  Object.fromEntries(Object.entries(r).map(([k, rows]) => [k, rows.length]));

describe("audit-data", () => {
  it("reports nothing on a clean, empty database", async () => {
    expect(Object.values(counts(await auditData(db, now))).every((n) => n === 0)).toBe(true);
  });

  it("finds every kind of problem on a messy database", async () => {
    const seeded = await seedMess();
    const report = await auditData(db, now);
    expect(counts(report)).toEqual({
      duplicateArtistsBySpotifyId: 0, // the unique index makes this impossible; checked anyway
      duplicateArtistsByName: 1,
      aliasShadowsArtist: 1,
      similarEvents: 1,
      pendingMergeReviews: 1,
      orphanArtists: 2,
      orphanVenues: 1,
      staleEventCandidates: 1,
      staleMatchCandidates: 1,
      publishedWithoutHeadliner: 1,
      publishedPast: 1,
      sharedPlaylistsNotPublished: 1,
    });
    expect(report.orphanArtists).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: seeded.orphan!.id, safe_to_delete: true }),
        expect.objectContaining({ id: seeded.manualOrphan!.id, safe_to_delete: false }),
      ]),
    );
    expect(report.publishedWithoutHeadliner[0]).toMatchObject({ id: seeded.noHeadliner!.id });
  });

  it("the default run is read-only", async () => {
    await seedMess();
    const before = await db.select().from(events);
    await auditData(db, now);
    expect(await db.select().from(events)).toEqual(before);
  });

  it("--fix archives past events and removes safe orphans only, leaving the rest for review", async () => {
    const seeded = await seedMess();
    expect(await applySafeFixes(db, now)).toEqual({
      archivedPastEvents: 1,
      deletedOrphanArtists: 1,
      deletedOrphanVenues: 1,
      deletedStaleEventCandidates: 1,
      deletedStaleMatchCandidates: 1,
    });
    const after = counts(await auditData(db, now));
    expect(after).toMatchObject({
      orphanArtists: 1, // the manual one (D-026)
      orphanVenues: 0,
      staleEventCandidates: 0,
      staleMatchCandidates: 0,
      publishedPast: 0,
      // Not safe to fix automatically:
      duplicateArtistsByName: 1,
      aliasShadowsArtist: 1,
      similarEvents: 1,
      publishedWithoutHeadliner: 1,
      sharedPlaylistsNotPublished: 1,
    });
    const archived = await db.select().from(events);
    expect(archived.find((e) => e.id === seeded.past!.id)?.visibility).toBe("archived");
    // Idempotent: a second run has nothing left to do.
    expect(Object.values(await applySafeFixes(db, now)).every((n) => n === 0)).toBe(true);
  });
});

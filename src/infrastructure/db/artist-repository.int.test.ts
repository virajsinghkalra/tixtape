import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { ConflictError } from "@/lib/errors";
import { testDb } from "../../../tests/setup/db";
import { PgArtistRepository } from "./artist-repository";
import { truncateEventTables } from "./events-test-db";

const db = testDb();
const repo = new PgArtistRepository(db);
afterAll(() => db.$close());
beforeEach(() => truncateEventTables(db));

describe("PgArtistRepository", () => {
  it("creates a pending artist once, even under concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => repo.findOrCreateByName("Ritviz", "ritviz")),
    );
    expect(new Set(results.map((a) => a.id)).size).toBe(1);
    expect(results[0]).toMatchObject({
      name: "Ritviz",
      normalizedName: "ritviz",
      matchStatus: "pending",
      spotifyId: null,
    });
  });

  it("resolves through aliases", async () => {
    const ar = await repo.findOrCreateByName("A.R. Rahman", "ar rahman");
    await repo.addAlias(ar.id, "a r rahman");
    await repo.addAlias(ar.id, "a r rahman");
    expect((await repo.findOrCreateByName("A R Rahman", "a r rahman")).id).toBe(ar.id);
    expect((await repo.findByAlias("ar rahman"))?.id).toBe(ar.id);
    expect(await repo.findByAlias("nobody")).toBeNull();
  });

  it("rejects an alias that belongs to another artist", async () => {
    const a = await repo.findOrCreateByName("Divine", "divine");
    const b = await repo.findOrCreateByName("Naezy", "naezy");
    await repo.addAlias(a.id, "gully gang");
    await expect(repo.addAlias(b.id, "gully gang")).rejects.toThrow(ConflictError);
  });

  it("records matches and lists artists needing resolution or review", async () => {
    const now = new Date("2026-11-21T00:00:00Z");
    const old = new Date("2026-09-01T00:00:00Z");
    const pending = await repo.findOrCreateByName("Pending", "pending");
    const stale = await repo.findOrCreateByName("Stale", "stale");
    const fresh = await repo.findOrCreateByName("Fresh", "fresh");
    const review = await repo.findOrCreateByName("Review", "review");
    const match = (id: string, resolvedAt: Date, status: "auto" | "needs_review") => ({
      spotifyId: status === "auto" ? asSpotifyArtistId(id) : null,
      score: 80,
      status,
      imageUrl: null,
      resolvedAt,
    });
    await repo.recordMatch(stale.id, match("sp-stale", old, "auto"));
    await repo.recordMatch(fresh.id, match("sp-fresh", now, "auto"));
    await repo.recordMatch(review.id, match("x", now, "needs_review"));

    const cutoff = new Date("2026-10-22T00:00:00Z");
    expect((await repo.listNeedingResolution(cutoff, 10)).map((a) => a.id)).toEqual([
      pending.id,
      stale.id,
    ]);
    expect((await repo.listNeedingResolution(cutoff, 1)).map((a) => a.id)).toEqual([pending.id]);
    expect((await repo.listNeedingReview(10)).map((a) => a.id)).toEqual([review.id]);
    expect(await repo.findById(stale.id)).toMatchObject({
      spotifyId: "sp-stale",
      matchScore: 80,
      matchStatus: "auto",
      spotifyResolvedAt: old,
    });
  });

  it("maps a duplicate Spotify ID to ConflictError", async () => {
    const a = await repo.findOrCreateByName("A", "a");
    const b = await repo.findOrCreateByName("B", "b");
    const m = {
      spotifyId: asSpotifyArtistId("same"),
      score: 90,
      status: "auto" as const,
      imageUrl: null,
      resolvedAt: new Date(),
    };
    await repo.recordMatch(a.id, m);
    await expect(repo.recordMatch(b.id, m)).rejects.toThrow(ConflictError);
  });
});

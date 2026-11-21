import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefreshedTokens } from "@/application/auth/ports";
import { spotifyTokens } from "@/db/schema";
import type { UserId } from "@/domain/shared/ids";
import { ok } from "@/lib/result";
import { TokenCipher, TokenDecryptError } from "@/infrastructure/crypto/token-cipher";
import { SpotifyAccessTokens } from "@/infrastructure/spotify/access-tokens";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgSpotifyTokenRepository } from "./spotify-token-repository";
import { PgUserRepository } from "./user-repository";

const db = testDb();
const cipher = new TokenCipher({ 1: randomBytes(32).toString("base64") }, 1);
const repo = new PgSpotifyTokenRepository(db, cipher);
const users = new PgUserRepository(db);
const tokens = (access: string, expiresAt = new Date(Date.now() + 3_600_000)) => ({
  accessToken: access,
  refreshToken: `refresh-for-${access}`,
  scope: "playlist-modify-private",
  expiresAt,
});

let alice: UserId;
let bob: UserId;
beforeEach(async () => {
  await truncateAll(db);
  alice = (
    await users.upsertBySpotifyId({ spotifyUserId: "alice", displayName: null, role: "user" })
  ).id;
  bob = (await users.upsertBySpotifyId({ spotifyUserId: "bob", displayName: null, role: "user" }))
    .id;
});
afterAll(() => db.$close());

describe("PgSpotifyTokenRepository", () => {
  it("returns null when nothing is stored", async () => {
    await expect(repo.find(alice)).resolves.toBeNull();
  });

  it("stores tokens encrypted and reads them back", async () => {
    await repo.save(alice, tokens("BQD-secret"));
    const [row] = await db.select().from(spotifyTokens).where(eq(spotifyTokens.userId, alice));
    expect(row?.accessTokenEnc.toString("latin1")).not.toContain("BQD-secret");
    expect(row?.keyVersion).toBe(1);
    await expect(repo.find(alice)).resolves.toMatchObject({
      ...tokens("BQD-secret", row!.expiresAt),
      userId: alice,
      needsReauth: false,
    });
  });

  it("upserts and clears needs_reauth on save", async () => {
    await repo.save(alice, tokens("one"));
    await repo.markNeedsReauth(alice);
    await expect(repo.find(alice)).resolves.toMatchObject({ needsReauth: true });
    await repo.save(alice, tokens("two"));
    await expect(repo.find(alice)).resolves.toMatchObject({
      accessToken: "two",
      needsReauth: false,
    });
  });

  it("refuses ciphertext copied from another user's row", async () => {
    await repo.save(alice, tokens("alice-token"));
    await repo.save(bob, tokens("bob-token"));
    const [a] = await db.select().from(spotifyTokens).where(eq(spotifyTokens.userId, alice));
    await db
      .update(spotifyTokens)
      .set({ accessTokenEnc: a!.accessTokenEnc })
      .where(eq(spotifyTokens.userId, bob));
    await expect(repo.find(bob)).rejects.toBeInstanceOf(TokenDecryptError);
  });

  it("serializes work under the per-user lock but not across users", async () => {
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, 50));
      order.push(`${label}:end`);
    };
    const other = testDb();
    try {
      const repo2 = new PgSpotifyTokenRepository(other, cipher);
      await Promise.all([
        repo.withUserLock(alice, slow("a1")),
        repo2.withUserLock(alice, slow("a2")),
      ]);
      expect(order.slice(0, 2)).toEqual([order[0], order[0]!.replace("start", "end")]);

      order.length = 0;
      await Promise.all([repo.withUserLock(alice, slow("a")), repo2.withUserLock(bob, slow("b"))]);
      expect(order.slice(0, 2).every((s) => s.endsWith(":start"))).toBe(true);
    } finally {
      await other.$close();
    }
  });

  it("refreshes only once when two processes need a new token at the same time", async () => {
    await repo.save(alice, tokens("stale", new Date(Date.now() + 10_000)));
    const refresh = vi.fn(async (): Promise<ReturnType<typeof ok<RefreshedTokens>>> => {
      await new Promise((r) => setTimeout(r, 50));
      return ok({
        accessToken: "fresh",
        refreshToken: "rotated",
        scope: "s",
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    });
    const other = testDb();
    try {
      const make = (r: PgSpotifyTokenRepository) =>
        new SpotifyAccessTokens({
          tokens: r,
          oauth: { refresh },
          appTokens: { clientCredentials: vi.fn() },
          clock: { now: () => new Date() },
        });
      const results = await Promise.all([
        make(repo).get({ kind: "user", userId: alice }),
        make(new PgSpotifyTokenRepository(other, cipher)).get({ kind: "user", userId: alice }),
      ]);
      expect(results).toEqual(["fresh", "fresh"]);
      expect(refresh).toHaveBeenCalledOnce();
      await expect(repo.find(alice)).resolves.toMatchObject({ refreshToken: "rotated" });
    } finally {
      await other.$close();
    }
  });
});

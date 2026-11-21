import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RefreshedTokens } from "@/application/auth/ports";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { TokenCipher } from "@/infrastructure/crypto/token-cipher";
import { PgSessionRepository } from "@/infrastructure/db/session-repository";
import { PgSpotifyGateStore } from "@/infrastructure/db/spotify-gate-store";
import { PgSpotifyTokenRepository } from "@/infrastructure/db/spotify-token-repository";
import { PgUserRepository } from "@/infrastructure/db/user-repository";
import { createSpotifyModule } from "@/infrastructure/spotify";
import { SpotifyAccessTokens } from "@/infrastructure/spotify/access-tokens";
import { ok, type Result } from "@/lib/result";
import { API, FakeClock, SeqRandom, T0, VirtualTime } from "./fakes";
import { testDb } from "../../setup/db";

const db = testDb();
const db2 = testDb(); // a second pool: "another process"
const KEY = randomBytes(32).toString("base64");
const cipher = new TokenCipher({ 1: KEY }, 1);

async function clean() {
  await db.execute(sql`TRUNCATE users, sessions, spotify_tokens, spotify_gate CASCADE`);
}
beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.$close();
  await db2.$close();
});

const users = new PgUserRepository(db);
async function mkUser(spotifyUserId: string): Promise<UserId> {
  return (await users.upsertBySpotifyId({ spotifyUserId, displayName: null, role: "user" })).id;
}
const tokenSet = (n: string, expiresAt = new Date(T0 + 3_600_000)) => ({
  accessToken: `AT-${n}`,
  refreshToken: `RT-${n}`,
  scope: "playlist-modify-private",
  expiresAt,
});

// ── Gate store ──────────────────────────────────────────────────────────────

describe("QA PgSpotifyGateStore (D-006)", () => {
  const gate = new PgSpotifyGateStore(db);

  it("reads null when nothing is paused (even with no row)", async () => {
    expect(await gate.readPausedUntil()).toBeNull();
  });

  it("extend works from an empty table and is readable by another connection", async () => {
    const t = new Date(T0 + 60_000);
    expect((await gate.extendPausedUntil(t)).getTime()).toBe(t.getTime());
    expect((await new PgSpotifyGateStore(db2).readPausedUntil())!.getTime()).toBe(t.getTime());
  });

  it("never moves the pause earlier (GREATEST)", async () => {
    await gate.extendPausedUntil(new Date(T0 + 120_000));
    const r = await gate.extendPausedUntil(new Date(T0 + 1_000));
    expect(r.getTime()).toBe(T0 + 120_000);
    expect((await gate.readPausedUntil())!.getTime()).toBe(T0 + 120_000);
    const later = await gate.extendPausedUntil(new Date(T0 + 500_000));
    expect(later.getTime()).toBe(T0 + 500_000);
  });

  it("keeps millisecond precision", async () => {
    await gate.extendPausedUntil(new Date(T0 + 1_234));
    expect((await gate.readPausedUntil())!.getTime()).toBe(T0 + 1_234);
  });

  it("concurrent extends from two pools end at the maximum, starting from no row", async () => {
    const times = Array.from({ length: 40 }, (_, i) => T0 + ((i * 7919) % 40) * 1_000);
    await Promise.all(
      times.map((t, i) => new PgSpotifyGateStore(i % 2 ? db : db2).extendPausedUntil(new Date(t))),
    );
    expect((await gate.readPausedUntil())!.getTime()).toBe(Math.max(...times));
    const rows = await db.execute(sql`select count(*)::int as n from spotify_gate`);
    expect((rows as unknown as { n: number }[])[0]!.n).toBe(1);
  });

  it("each concurrent extend returns a value ≥ its own input", async () => {
    const inputs = Array.from({ length: 20 }, (_, i) => new Date(T0 + (20 - i) * 1_000));
    const outs = await Promise.all(inputs.map((d) => gate.extendPausedUntil(d)));
    outs.forEach((o, i) => expect(o.getTime()).toBeGreaterThanOrEqual(inputs[i]!.getTime()));
  });
});

// ── Sessions ────────────────────────────────────────────────────────────────

describe("QA PgSessionRepository (LLD §12: random id stored hashed)", () => {
  const sessions = new PgSessionRepository(db);
  const RAW = "qa-raw-session-id-0123456789abcdefghijklmnop";

  it("never stores the raw id anywhere in the row", async () => {
    const u = await mkUser("s1");
    await sessions.create(RAW, u, new Date(T0 + 3_600_000));
    const rows = await db.execute(sql`select * from sessions`);
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(RAW);
    const idHash = (rows as unknown as { id_hash: string }[])[0]!.id_hash;
    expect(idHash).toMatch(/^[0-9a-f]{64}$|^[A-Za-z0-9_-]{43}=?$/); // SHA-256 hex or base64url
  });

  it("finds the user before expiry; null at/after expiry; null for unknown", async () => {
    const u = await mkUser("s2");
    const exp = new Date(T0 + 3_600_000);
    await sessions.create(RAW, u, exp);
    expect(await sessions.findUserId(RAW, new Date(T0))).toBe(u);
    expect(await sessions.findUserId(RAW, new Date(exp.getTime() + 1))).toBeNull();
    expect(await sessions.findUserId("nope", new Date(T0))).toBeNull();
    expect(await sessions.findUserId("", new Date(T0))).toBeNull();
  });

  it("looking up by the stored hash itself does not authenticate", async () => {
    const u = await mkUser("s3");
    await sessions.create(RAW, u, new Date(T0 + 3_600_000));
    const rows = await db.execute(sql`select id_hash from sessions`);
    const idHash = (rows as unknown as { id_hash: string }[])[0]!.id_hash;
    expect(await sessions.findUserId(idHash, new Date(T0))).toBeNull();
  });

  it("delete removes it; deleting an unknown id is harmless", async () => {
    const u = await mkUser("s4");
    await sessions.create(RAW, u, new Date(T0 + 3_600_000));
    await sessions.delete(RAW);
    expect(await sessions.findUserId(RAW, new Date(T0))).toBeNull();
    await expect(sessions.delete("unknown")).resolves.toBeUndefined();
  });
});

// ── Users ───────────────────────────────────────────────────────────────────

describe("QA PgUserRepository", () => {
  it("upsert updates name/role, keeps market", async () => {
    const a = await users.upsertBySpotifyId({
      spotifyUserId: "u1",
      displayName: "A",
      role: "admin",
    });
    expect(a.market).toBe("IN");
    await db.execute(sql`update users set market = 'DE' where id = ${a.id}`);
    const b = await users.upsertBySpotifyId({
      spotifyUserId: "u1",
      displayName: "B",
      role: "user",
    });
    expect(b).toMatchObject({ id: a.id, displayName: "B", role: "user", market: "DE" });
    expect((await users.findById(a.id))!.market).toBe("DE");
  });

  it("findById unknown → null", async () => {
    expect(await users.findById(asUserId("11111111-1111-4111-8111-111111111111"))).toBeNull();
  });
});

// ── Tokens ──────────────────────────────────────────────────────────────────

describe("QA PgSpotifyTokenRepository (LLD §8.1, §12, D-021)", () => {
  const repo = new PgSpotifyTokenRepository(db, cipher);

  it("round-trips; the DB holds only ciphertext + key_version", async () => {
    const u = await mkUser("t1");
    await repo.save(u, tokenSet("one"));
    expect(await repo.find(u)).toMatchObject({ ...tokenSet("one"), userId: u, needsReauth: false });
    const rows = (await db.execute(
      sql`select access_token_enc, refresh_token_enc, key_version from spotify_tokens`,
    )) as unknown as { access_token_enc: Buffer; refresh_token_enc: Buffer; key_version: number }[];
    expect(rows[0]!.key_version).toBe(1);
    expect(Buffer.from(rows[0]!.access_token_enc).includes(Buffer.from("AT-one"))).toBe(false);
    expect(Buffer.from(rows[0]!.refresh_token_enc).includes(Buffer.from("RT-one"))).toBe(false);
  });

  it("find for a user without tokens → null", async () => {
    expect(await repo.find(await mkUser("t2"))).toBeNull();
  });

  it("markNeedsReauth sets the flag; save clears it and overwrites", async () => {
    const u = await mkUser("t3");
    await repo.save(u, tokenSet("a"));
    await repo.markNeedsReauth(u);
    expect((await repo.find(u))!.needsReauth).toBe(true);
    await repo.save(u, tokenSet("b"));
    expect(await repo.find(u)).toMatchObject({
      accessToken: "AT-b",
      refreshToken: "RT-b",
      needsReauth: false,
    });
  });

  it("ciphertext copied to another user's row fails to decrypt (AAD)", async () => {
    const a = await mkUser("t4a");
    const b = await mkUser("t4b");
    await repo.save(a, tokenSet("alice"));
    await repo.save(b, tokenSet("bob"));
    await db.execute(sql`update spotify_tokens set
        access_token_enc = (select access_token_enc from spotify_tokens where user_id = ${a}),
        refresh_token_enc = (select refresh_token_enc from spotify_tokens where user_id = ${a})
      where user_id = ${b}`);
    await expect(repo.find(b)).rejects.toThrow();
  });

  it("access/refresh columns swapped fails to decrypt (AAD binds the column)", async () => {
    const u = await mkUser("t5");
    await repo.save(u, tokenSet("x"));
    await db.execute(sql`update spotify_tokens set
        access_token_enc = refresh_token_enc, refresh_token_enc = access_token_enc where user_id = ${u}`);
    await expect(repo.find(u)).rejects.toThrow();
  });

  it("unknown key_version fails", async () => {
    const u = await mkUser("t6");
    await repo.save(u, tokenSet("x"));
    await db.execute(sql`update spotify_tokens set key_version = 9 where user_id = ${u}`);
    await expect(repo.find(u)).rejects.toThrow();
  });

  it("rotated key: rows written under v1 still read with {1,2}@2, and re-save uses v2", async () => {
    const u = await mkUser("t7");
    await repo.save(u, tokenSet("x"));
    const rotated = new PgSpotifyTokenRepository(
      db,
      new TokenCipher({ 1: KEY, 2: randomBytes(32).toString("base64") }, 2),
    );
    expect((await rotated.find(u))!.accessToken).toBe("AT-x");
    await rotated.save(u, tokenSet("y"));
    const rows = (await db.execute(sql`select key_version from spotify_tokens`)) as unknown as {
      key_version: number;
    }[];
    expect(rows[0]!.key_version).toBe(2);
  });

  it("withUserLock serialises the same user across pools; other users are not blocked", async () => {
    const u = await mkUser("t8");
    const v = await mkUser("t9");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    const a = repo.withUserLock(u, async () => {
      order.push("A-in");
      await held;
      order.push("A-out");
    });
    await waitFor(() => order.includes("A-in"));
    const other = await new PgSpotifyTokenRepository(db2, cipher).withUserLock(
      v,
      async () => "free",
    );
    expect(other).toBe("free");
    const b = new PgSpotifyTokenRepository(db2, cipher).withUserLock(u, async () => {
      order.push("B-in");
    });
    expect(await waitForAdvisoryWaiter()).toBe(true);
    expect(order).toEqual(["A-in"]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["A-in", "A-out", "B-in"]);
  });

  it("withUserLock rolls back writes when fn throws", async () => {
    const u = await mkUser("t10");
    await repo.save(u, tokenSet("orig"));
    await expect(
      repo.withUserLock(u, async (tx) => {
        await tx.save(u, tokenSet("inside"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await repo.find(u))!.accessToken).toBe("AT-orig");
  });
});

async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
}
/** Polls pg_locks until some session is waiting on an advisory lock (no sleeps). */
async function waitForAdvisoryWaiter(): Promise<boolean> {
  for (let i = 0; i < 400; i++) {
    const r = (await db.execute(
      sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    )) as unknown as { n: number }[];
    if (r[0]!.n > 0) return true;
  }
  return false;
}

// ── Cross-process refresh (advisory lock) ───────────────────────────────────

describe("QA concurrent refresh for one user across processes → one refresh (LLD §8.1)", () => {
  it("two workers with expiring tokens trigger a single refresh", async () => {
    const u = await mkUser("r1");
    await new PgSpotifyTokenRepository(db, cipher).save(u, tokenSet("old", new Date(T0 + 10_000)));
    let refreshes = 0;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const clock = new FakeClock();
    const worker = (pool: typeof db) =>
      new SpotifyAccessTokens({
        tokens: new PgSpotifyTokenRepository(pool, cipher),
        clock,
        appTokens: {
          clientCredentials: async () => ({
            accessToken: "app",
            expiresAt: new Date(T0 + 3_600_000),
          }),
        },
        oauth: {
          refresh: async (): Promise<Result<RefreshedTokens, "invalid_grant">> => {
            refreshes++;
            await held;
            return ok({ ...tokenSet(`new${refreshes}`), refreshToken: `RT-rot${refreshes}` });
          },
        },
      });
    const p1 = worker(db).get({ kind: "user", userId: u });
    await waitFor(() => refreshes === 1);
    const p2 = worker(db2).get({ kind: "user", userId: u });
    expect(await waitForAdvisoryWaiter()).toBe(true);
    release();
    const [a, b] = await Promise.all([p1, p2]);
    expect(refreshes).toBe(1);
    expect(a).toBe("AT-new1");
    expect(b).toBe("AT-new1");
    const stored = await new PgSpotifyTokenRepository(db, cipher).find(u);
    expect(stored!.refreshToken).toBe("RT-rot1");
  });
});

// ── Module-level: the gate is shared through Postgres ───────────────────────

describe("QA createSpotifyModule: a long 429 in one process blocks the other (LLD §14)", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterAll(() => server.close());

  it("process A gets Retry-After 5000 → process B makes no call and throws", async () => {
    let apiCalls = 0;
    server.use(
      mock.post("https://accounts.spotify.com/api/token", () =>
        HttpResponse.json({ access_token: "APP", token_type: "Bearer", expires_in: 3600 }),
      ),
      mock.get(`${API}/qa`, () => {
        apiCalls++;
        return HttpResponse.json({}, { status: 429, headers: { "Retry-After": "5000" } });
      }),
    );
    const make = (pool: typeof db, time: VirtualTime) =>
      createSpotifyModule({
        db: pool,
        clock: time.clock,
        random: new SeqRandom(0.5),
        spotify: { clientId: "c", clientSecret: "s", redirectUri: "http://127.0.0.1:3000/cb" },
        tokenEncryption: { key: KEY, version: 1 },
        fetch: (i, init) => globalThis.fetch(i, init),
        sleep: time.sleep,
      });
    const ta = new VirtualTime();
    const tb = new VirtualTime();
    const A = make(db, ta);
    const B = make(db2, tb);
    const req = {
      method: "GET" as const,
      path: "/qa",
      auth: { kind: "app" as const },
      schema: z.object({}),
    };
    await expect(ta.run(A.http.request(req))).rejects.toBeInstanceOf(SpotifyBlockedError);
    const e = await tb.run(B.http.request(req)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect((e as SpotifyBlockedError).reason).toBe("gate_paused");
    expect((e as SpotifyBlockedError).resumeAfter.getTime()).toBeGreaterThanOrEqual(T0 + 5_000_000);
    expect(apiCalls).toBe(1);
  });
});

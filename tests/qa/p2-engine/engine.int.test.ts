/**
 * QA P2.3–P2.5 on real Postgres: the wired playlists module (createPlaylistsModule) with QA
 * fakes for Spotify, events and tokens. Checks D-029/D-036/D-037 integrity under concurrency.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/db/client";
import { createPlaylistsModule, type PlaylistsModule } from "@/infrastructure/playlists-module";
import { asEventId, type EventId, type PlaylistJobId } from "@/domain/shared/ids";
import { NotFoundError } from "@/lib/errors";
import { testDb } from "../../setup/db";
import {
  FakeCatalog,
  FakeEvents,
  FakeWriter,
  PUBLISHER,
  PublisherWorld,
  SECRET_ACCESS,
  SECRET_REFRESH,
  makeEvent,
  seedArtists,
  wholePoolShow,
  type ArtistSpec,
} from "./fakes";

const db: Database = testDb();
const TABLES = "playlist_jobs, shared_playlists, spotify_publisher, users, events";
const E1 = asEventId("66666666-6666-4666-8666-000000000001");
const E2 = asEventId("66666666-6666-4666-8666-000000000002");

type Ctx = {
  ops: string[];
  writer: FakeWriter;
  tracks: FakeCatalog;
  events: FakeEvents;
  pub: PublisherWorld;
  warnings: unknown[];
  appleCalls: number;
  mod: PlaylistsModule;
};
let c: Ctx;

async function insertEvent(id: EventId, hash: string) {
  await db.execute(sql`
    INSERT INTO events (id, title, type, starts_at, dedupe_key, lineup_hash)
    VALUES (${id}, 'QA Fest', 'festival', now() + interval '30 days', ${`qa-p2-${id}`}, ${hash})`);
}

/** Lets the test drive a "world" like the unit fakes, but with the real DB-backed module. */
function build(appleFails = false): Ctx {
  const ops: string[] = [];
  const ctx = {
    ops,
    writer: new FakeWriter(ops),
    tracks: new FakeCatalog(),
    events: new FakeEvents(),
    pub: new PublisherWorld(),
    warnings: [] as unknown[],
    appleCalls: 0,
  } as Ctx;
  ctx.mod = createPlaylistsModule({
    db,
    clock: { now: () => new Date() },
    logger: { warn: (...a: unknown[]) => void ctx.warnings.push(a) } as never,
    trackCatalog: ctx.tracks,
    playlistWriter: ctx.writer,
    events: ctx.events,
    users: ctx.pub.users,
    tokens: ctx.pub.tokens,
    fetch: (async () => {
      ctx.appleCalls += 1;
      if (appleFails) return new Response("<html>oops</html>", { status: 500 });
      return Response.json({ feed: { results: [] } });
    }) as typeof fetch,
    sleep: async () => {},
  });
  return ctx;
}

async function seed(eventId: EventId, artists: ArtistSpec[], hash = "hash-1", wholePool = false) {
  await insertEvent(eventId, hash);
  const event = makeEvent(eventId, artists, hash);
  // D-080: the song cache references `artists`, so lineup artists need real rows, as in prod.
  for (const a of event.lineup) {
    await db.execute(sql`
      INSERT INTO artists (id, name, normalized_name)
      VALUES (${a.artistId}, ${a.name}, ${a.name.toLowerCase()})
      ON CONFLICT (id) DO NOTHING`);
  }
  c.events.put(wholePool ? wholePoolShow(event) : event);
}

async function runToEnd(jobId: PlaylistJobId, max = 200) {
  for (let i = 0; i < max; i += 1) {
    const p = await c.mod.step(jobId);
    if (["succeeded", "partial", "failed"].includes(p.status)) return p;
    // Leases are DB-time based; skip ahead instead of sleeping.
    await db.execute(
      sql`UPDATE playlist_jobs SET locked_until = NULL, resume_after = NULL WHERE id = ${jobId}`,
    );
  }
  throw new Error("build did not finish");
}

const count = async (q: ReturnType<typeof sql>) =>
  Number(((await db.execute(q)) as unknown as { n: string }[])[0]!.n);
const contents = (eventId: EventId) =>
  db
    .execute(sql`SELECT spotify_playlist_id FROM shared_playlists WHERE event_id = ${eventId}`)
    .then((r) => {
      const row = (r as unknown as { spotify_playlist_id: string }[])[0];
      return row ? c.writer.playlists.get(row.spotify_playlist_id)! : [];
    });

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  await db.execute(
    sql`INSERT INTO users (id, spotify_user_id, display_name, role) VALUES (${PUBLISHER}, 'qa-publisher', 'Publisher', 'admin')`,
  );
  await db.execute(sql`INSERT INTO spotify_publisher (id, user_id) VALUES (1, ${PUBLISHER})`);
  c = build();
});

afterAll(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES} RESTART IDENTITY CASCADE`));
  await db.$close();
});

describe("QA engine on Postgres", () => {
  it("25 concurrent POSTs for one event → exactly one active shared job", async () => {
    await seed(E1, seedArtists(c as never, 2, "headliner", 10));
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => c.mod.startSharedBuild(E1, `10.1.0.${i}`)),
    );
    const ids = new Set(results.map((r) => (r.status === "building" ? r.jobId : "ready")));
    expect(ids.size).toBe(1);
    expect(await count(sql`SELECT count(*) AS n FROM playlist_jobs WHERE event_id = ${E1}`)).toBe(
      1,
    );
  });

  it("concurrent steps never double-create or double-write; one shared row (D-029)", async () => {
    // D-065: a long show, so all 250 seeded songs fit (three write chunks).
    await seed(E1, seedArtists(c as never, 25, "headliner", 10), "hash-1", true);
    const r = await c.mod.startSharedBuild(E1, "ip");
    if (r.status !== "building") throw new Error("expected building");
    for (let i = 0; i < 40; i += 1) {
      const ps = await Promise.all(Array.from({ length: 6 }, () => c.mod.step(r.jobId)));
      for (const p of ps) expect(p.progress >= 0 && p.progress <= 100).toBe(true);
      if (ps.some((p) => ["succeeded", "partial", "failed"].includes(p.status))) break;
      await db.execute(sql`UPDATE playlist_jobs SET locked_until = NULL WHERE id = ${r.jobId}`);
    }
    const final = await c.mod.getProgress(r.jobId);
    expect(final.status).toBe("succeeded");
    expect(c.writer.count("create")).toBe(1);
    expect(
      await count(sql`SELECT count(*) AS n FROM shared_playlists WHERE event_id = ${E1}`),
    ).toBe(1);
    const pl = await contents(E1);
    expect(pl).toHaveLength(250);
    expect(new Set(pl).size).toBe(250);
  });

  it("finished playlist reused; lineup change rebuilds into the SAME Spotify playlist", async () => {
    const artists = seedArtists(c as never, 3, "headliner", 10);
    await seed(E1, artists);
    const r1 = await c.mod.startSharedBuild(E1, "ip");
    if (r1.status !== "building") throw new Error("expected building");
    await runToEnd(r1.jobId);
    const ready = await c.mod.startSharedBuild(E1, "ip");
    expect(ready.status).toBe("ready");
    const first = (await db.execute(
      sql`SELECT spotify_playlist_id FROM shared_playlists WHERE event_id = ${E1}`,
    )) as unknown as { spotify_playlist_id: string }[];

    const more = seedArtists(c as never, 2, "headliner", 10, 10, "added");
    await db.execute(sql`UPDATE events SET lineup_hash = 'hash-2' WHERE id = ${E1}`);
    c.events.put(makeEvent(E1, [...artists, ...more], "hash-2"));
    expect(await c.mod.getSharedStatus(E1)).toMatchObject({ status: "ready", stale: true });
    const r2 = await c.mod.startSharedBuild(E1, "ip");
    if (r2.status !== "building") throw new Error("expected a rebuild");
    expect(r2.jobId).not.toBe(r1.jobId);
    await runToEnd(r2.jobId);
    const after = (await db.execute(
      sql`SELECT spotify_playlist_id, lineup_hash_at_build FROM shared_playlists WHERE event_id = ${E1}`,
    )) as unknown as { spotify_playlist_id: string; lineup_hash_at_build: string }[];
    expect(after).toHaveLength(1);
    expect(after[0]!.spotify_playlist_id).toBe(first[0]!.spotify_playlist_id);
    expect(after[0]!.lineup_hash_at_build).toBe("hash-2");
    expect(c.writer.count("create")).toBe(1);
    expect(await contents(E1)).toHaveLength(50);
    expect(await c.mod.getSharedStatus(E1)).toMatchObject({ status: "ready", stale: false });
  });

  it("a step killed mid-chunk resumes after the lease expires without duplicates", async () => {
    // D-065: a long show, so all 250 seeded songs fit (three write chunks).
    await seed(E1, seedArtists(c as never, 25, "headliner", 10), "hash-1", true);
    const r = await c.mod.startSharedBuild(E1, "ip");
    if (r.status !== "building") throw new Error("expected building");
    c.writer.after = (_k, _i, no) => (no === 2 ? new Promise<never>(() => {}) : undefined);
    void c.mod.step(r.jobId);
    for (let i = 0; i < 200 && c.writer.calls.filter((x) => x.kind !== "create").length < 2; i += 1)
      await new Promise((res) => setTimeout(res, 5));
    expect(c.writer.calls.filter((x) => x.kind !== "create").length).toBe(2);
    c.writer.after = undefined;
    // Simulate the 15 s lease running out (no real sleep).
    await db.execute(
      sql`UPDATE playlist_jobs SET locked_until = now() - interval '1 second' WHERE id = ${r.jobId}`,
    );
    const p = await runToEnd(r.jobId);
    expect(p.status).toBe("succeeded");
    const pl = await contents(E1);
    expect(pl).toHaveLength(250);
    expect(new Set(pl).size).toBe(250);
  });

  it("two events get two shared rows with distinct Spotify ids", async () => {
    await seed(E1, seedArtists(c as never, 1, "headliner", 10));
    await seed(E2, seedArtists(c as never, 1, "headliner", 10, 1, "second"));
    for (const e of [E1, E2]) {
      const r = await c.mod.startSharedBuild(e, "ip");
      if (r.status === "building") await runToEnd(r.jobId);
    }
    expect(
      await count(sql`SELECT count(DISTINCT spotify_playlist_id) AS n FROM shared_playlists`),
    ).toBe(2);
  });

  it("Apple chart outage and no Last.fm key: build still succeeds", async () => {
    c = build(true);
    await seed(E1, seedArtists(c as never, 2, "headliner", 10));
    const r = await c.mod.startSharedBuild(E1, "ip");
    if (r.status !== "building") throw new Error("expected building");
    const p = await runToEnd(r.jobId);
    expect(p.status).toBe("succeeded");
    expect(c.appleCalls).toBeGreaterThan(0);
    expect(await contents(E1)).toHaveLength(20);
  });

  it("unknown job → NotFoundError; stored jobs never hold tokens", async () => {
    await expect(
      c.mod.step("11111111-1111-4111-8111-111111111111" as PlaylistJobId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await seed(E1, seedArtists(c as never, 1, "headliner", 10));
    const r = await c.mod.startSharedBuild(E1, "ip");
    if (r.status === "building") await runToEnd(r.jobId);
    const dump =
      JSON.stringify(await db.execute(sql`SELECT * FROM playlist_jobs`)) +
      JSON.stringify(await db.execute(sql`SELECT * FROM shared_playlists`)) +
      JSON.stringify(c.warnings);
    expect(dump).not.toContain(SECRET_ACCESS);
    expect(dump).not.toContain(SECRET_REFRESH);
  });
});

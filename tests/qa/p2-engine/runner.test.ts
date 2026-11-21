/**
 * QA P2.3 / P2.4: shared builds, the step runner and the playlist writer on in-memory fakes
 * that follow the port contracts (D-005, D-006, D-020, D-036, D-040, LLD §7.3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEASE_MS,
  NoMatchedArtistsError,
  PlaylistUnavailableError,
  SHORT_PAUSE_MS,
  UNAVAILABLE_MESSAGE,
  parseJobId,
  type BuildProgress,
} from "@/application/playlists";
import { ReauthRequiredError, SpotifyBlockedError } from "@/application/ports/spotify";
import { asPlaylistJobId, type PlaylistJobId } from "@/domain/shared/ids";
import { NotFoundError, RateLimitedError } from "@/lib/errors";
import {
  EVENT,
  PUBLISHER,
  SECRET_ACCESS,
  SECRET_REFRESH,
  makeEvent,
  makeWorld,
  runToEnd,
  seedArtists,
  type ArtistSpec,
  wholePoolShow,
  type World,
} from "./fakes";

const GHOST = asPlaylistJobId("11111111-1111-4111-8111-111111111111");
const FINISHED = ["succeeded", "partial"];
const never = () => new Promise<never>(() => {});

let w: World;
beforeEach(() => {
  w = makeWorld();
});

async function start(): Promise<PlaylistJobId> {
  const r = await w.uc.startSharedBuild(EVENT, "1.2.3.4");
  if (r.status !== "building") throw new Error(`expected building, got ${JSON.stringify(r)}`);
  return r.jobId;
}
const playlistOf = (wld: World) => {
  const row = wld.shared.rows.get(EVENT);
  return row ? wld.writer.playlists.get(row.spotifyPlaylistId)! : [];
};
/** A lineup giving exactly `n` tracks: headliners × 10, then single-song support artists. */
function lineupWithTracks(wld: World, n: number): ArtistSpec[] {
  const heads = seedArtists(wld, Math.floor(n / 10), "headliner", 10);
  const singles = Array.from({ length: n % 10 }, (_, i) =>
    seedArtists(wld, 1, "support", 1, 100 + i, `single${i}`),
  ).flat();
  return [...heads, ...singles];
}

describe("QA startSharedBuild (D-036)", () => {
  it("unknown event → NotFoundError", async () => {
    await expect(w.uc.startSharedBuild(EVENT, "ip")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("no matched artist → NoMatchedArtistsError", async () => {
    w.events.put(
      makeEvent(EVENT, [{ name: "Unmatched", tier: "headliner", rank: 1, spotifyId: null }]),
    );
    await expect(w.uc.startSharedBuild(EVENT, "ip")).rejects.toBeInstanceOf(NoMatchedArtistsError);
  });

  it.each(["missing-publisher", "missing", "reauth"] as const)(
    "publisher %s → PlaylistUnavailableError",
    async (kind) => {
      w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
      if (kind === "missing-publisher") w.pub.record = null;
      else w.pub.token = kind;
      const e = await w.uc.startSharedBuild(EVENT, "ip").catch((x: unknown) => x);
      expect(e).toBeInstanceOf(PlaylistUnavailableError);
      expect(JSON.stringify(e) + String(e)).not.toContain(SECRET_ACCESS);
      expect(w.jobs.jobs.size).toBe(0);
    },
  );

  it("a second start joins the active build", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const a = await start();
    const b = await start();
    expect(b).toBe(a);
  });

  it("20 concurrent starts create exactly one job", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const all = await Promise.all(
      Array.from({ length: 20 }, (_, i) => w.uc.startSharedBuild(EVENT, `10.0.0.${i}`)),
    );
    const ids = new Set(all.map((r) => (r.status === "building" ? r.jobId : r.url)));
    expect(ids.size).toBe(1);
    expect(w.jobs.jobs.size).toBe(1);
  });

  it("rate limited → RateLimitedError with retryAfterSeconds", async () => {
    w = makeWorld({ limiter: { tryTake: async () => false, retryAfterSeconds: () => 1234 } });
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const e = await w.uc.startSharedBuild(EVENT, "ip").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RateLimitedError);
    expect((e as RateLimitedError).retryAfterSeconds).toBe(1234);
  });

  it("joining an active build or opening a ready one does not consume the start limit", async () => {
    const tryTake = vi.fn(async () => true);
    w = makeWorld({ limiter: { tryTake, retryAfterSeconds: () => 0 } });
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const id = await start();
    await start();
    await runToEnd(w, id);
    await w.uc.startSharedBuild(EVENT, "1.2.3.4");
    expect(tryTake).toHaveBeenCalledTimes(1);
  });

  it("getProgress does no work", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 2, "headliner", 10)));
    const id = await start();
    const p = await w.uc.getProgress(id);
    expect(p.status).toBe("queued");
    expect(w.tracks.searches).toHaveLength(0);
    expect(w.writer.calls).toHaveLength(0);
  });

  it("unknown / malformed job ids → NotFoundError", async () => {
    await expect(w.uc.step(GHOST)).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.uc.getProgress(GHOST)).rejects.toBeInstanceOf(NotFoundError);
    for (const raw of [
      "abc",
      "",
      "../../etc",
      "11111111-1111-4111-8111-11111111111Z",
      "' OR 1=1 --",
    ])
      expect(() => parseJobId(raw)).toThrow(NotFoundError);
  });
});

describe("QA full build (P2.3/P2.4)", () => {
  it("builds one public playlist with the publisher, headliners first, unmatched listed", async () => {
    const heads = seedArtists(w, 3, "headliner", 10);
    const subs = seedArtists(w, 2, "sub", 5, 10);
    w.events.put(
      makeEvent(EVENT, [
        ...heads,
        ...subs,
        { name: "Not On Spotify", tier: "support", rank: 50, spotifyId: null },
      ]),
    );
    const id = await start();
    const { last, seen } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    expect(last.unresolved).toContain("Not On Spotify");
    expect(last.playlistUrl).toMatch(/^https:\/\/open\.spotify\.com\/playlist\//);
    expect(w.writer.count("create")).toBe(1);
    expect(w.writer.createInputs[0]).toMatchObject({
      public: true,
      name: "QA Fest 2026 · Tixtape",
    });
    expect(w.writer.calls.every((c) => c.userId === PUBLISHER)).toBe(true);
    const pl = playlistOf(w);
    expect(pl).toHaveLength(40);
    expect(new Set(pl).size).toBe(40);
    // headliner tracks all come before sub tracks
    const lastHead = Math.max(...pl.map((t, i) => (t.includes("headliner") ? i : -1)));
    const firstSub = Math.min(...pl.map((t, i) => (t.includes("sub") ? i : 999)));
    expect(lastHead).toBeLessThan(firstSub);
    // never two in a row by one artist (equal counts → always avoidable)
    const artistOf = (t: string) => t.slice(0, t.lastIndexOf("x"));
    for (let i = 1; i < 30; i += 1) expect(artistOf(pl[i]!)).not.toBe(artistOf(pl[i - 1]!));
    expect(w.shared.rows.get(EVENT)!.lineupHashAtBuild).toBe("hash-1");
    expect(JSON.stringify(seen)).not.toContain(SECRET_ACCESS);
    expect(JSON.stringify(seen)).not.toContain(SECRET_REFRESH);
  });

  it("an artist with zero songs is listed as unresolved, not a crash", async () => {
    w.events.put(
      makeEvent(EVENT, [
        ...seedArtists(w, 1, "headliner", 10),
        ...seedArtists(w, 1, "mid", 0, 5, "empty"),
      ]),
    );
    const { last } = await runToEnd(w, await start());
    expect(last.status).toBe("partial");
    expect(last.unresolved).toHaveLength(1);
  });

  it("saves the playlist id before adding any items", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 2, "headliner", 10)));
    await runToEnd(w, await start());
    const firstWrite = w.ops.findIndex((o) => o.startsWith("add:") || o.startsWith("replace:"));
    const saved = w.ops.findIndex((o) => o.startsWith("saveCreated:"));
    expect(saved).toBeGreaterThan(-1);
    expect(saved).toBeLessThan(firstWrite);
  });

  it("progress stays in 0–100, never goes backwards, ends at 100; checkpoints are monotonic", async () => {
    // D-065: a long show, so all 340 seeded songs fit.
    w.events.put(
      wholePoolShow(
        makeEvent(EVENT, [
          ...seedArtists(w, 30, "headliner", 10),
          ...seedArtists(w, 20, "support", 2, 100),
        ]),
      ),
    );
    // Make time pass while working so the 8 s budget splits the build into several steps.
    w.tracks.onSearch = () => w.clock.advance(400);
    const id = await start();
    const { last, seen } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    expect(seen.length).toBeGreaterThan(1);
    const ps = seen.map((p) => p.progress);
    for (const p of ps) expect(p >= 0 && p <= 100).toBe(true);
    for (let i = 1; i < ps.length; i += 1) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]!);
    expect(ps[ps.length - 1]).toBe(100);
    for (const p of seen) expect(p.artistsDone).toBeLessThanOrEqual(p.artistsTotal);
    const cps = w.jobs.checkpoints(id);
    const stages = ["select", "create", "write", "done"];
    for (let i = 1; i < cps.length; i += 1) {
      expect(cps[i]!.artistIndex).toBeGreaterThanOrEqual(cps[i - 1]!.artistIndex);
      expect(cps[i]!.chunksDone).toBeGreaterThanOrEqual(cps[i - 1]!.chunksDone);
      expect(stages.indexOf(cps[i]!.stage)).toBeGreaterThanOrEqual(
        stages.indexOf(cps[i - 1]!.stage),
      );
    }
    expect(playlistOf(w)).toHaveLength(340);
  });

  it("a finished build is reused while the lineup hash is unchanged", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    await runToEnd(w, await start());
    const r = await w.uc.startSharedBuild(EVENT, "5.6.7.8");
    expect(r.status).toBe("ready");
    expect(w.jobs.jobs.size).toBe(1);
    const s = await w.uc.getSharedStatus(EVENT);
    expect(s).toMatchObject({ status: "ready", stale: false });
  });

  it("stepping a finished job is a no-op", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const id = await start();
    await runToEnd(w, id);
    const calls = w.writer.calls.length;
    const p = await w.uc.step(id);
    expect(FINISHED).toContain(p.status);
    expect(p.progress).toBe(100);
    expect(w.writer.calls.length).toBe(calls);
  });

  it("long / Unicode titles produce a valid name and description", async () => {
    w.events.put(
      makeEvent(EVENT, seedArtists(w, 1, "headliner", 10), "hash-1", "🎸 लोलापालूज़ा ".repeat(40)),
    );
    await runToEnd(w, await start());
    const input = w.writer.createInputs[0]!;
    expect(input.name.length).toBeLessThanOrEqual(100);
    expect(input.description.length).toBeLessThanOrEqual(300);
  });

  it("handles a 300-artist lineup", async () => {
    const tiers = [
      ...seedArtists(w, 30, "headliner", 10),
      ...seedArtists(w, 60, "sub", 5, 100),
      ...seedArtists(w, 90, "mid", 3, 200),
      ...seedArtists(w, 120, "support", 2, 400),
    ];
    // D-065: a long show, so every artist's whole pool fits.
    w.events.put(wholePoolShow(makeEvent(EVENT, tiers)));
    const t0 = performance.now();
    const { last } = await runToEnd(w, await start(), 1000);
    expect(last.status).toBe("succeeded");
    expect(last.artistsTotal).toBe(300);
    expect(playlistOf(w)).toHaveLength(300 + 300 + 270 + 240);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

describe("QA writer chunking (D-036, LLD §7.3)", () => {
  it.each([1, 100, 101, 250])(
    "%i tracks: ≤100 per call, no empty calls, exact contents",
    async (n) => {
      // D-065: a long show, so exactly n songs land.
      w.events.put(wholePoolShow(makeEvent(EVENT, lineupWithTracks(w, n))));
      const { last } = await runToEnd(w, await start());
      expect(FINISHED).toContain(last.status);
      const writes = w.writer.calls.filter((c) => c.kind !== "create");
      expect(writes.every((c) => c.n <= 100)).toBe(true);
      expect(writes.filter((c) => c.kind === "add").every((c) => c.n > 0)).toBe(true);
      expect(writes.length).toBe(Math.ceil(n / 100));
      const pl = playlistOf(w);
      expect(pl).toHaveLength(n);
      expect(new Set(pl).size).toBe(n);
    },
  );

  it("0 tracks (every matched artist has no songs): no crash, no empty add call", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 2, "headliner", 0)));
    const { last } = await runToEnd(w, await start());
    expect(["succeeded", "partial", "failed"]).toContain(last.status);
    expect(w.writer.calls.filter((c) => c.kind === "add" && c.n === 0)).toHaveLength(0);
    expect(last.unresolved.length).toBe(2);
  });

  it("rebuild after a lineup change writes into the SAME playlist: replace first, then add", async () => {
    const original = seedArtists(w, 25, "headliner", 10);
    // D-065: a long show, so every seeded song fits before and after the change.
    w.events.put(wholePoolShow(makeEvent(EVENT, original, "hash-1")));
    await runToEnd(w, await start());
    const firstId = w.shared.rows.get(EVENT)!.spotifyPlaylistId;
    const stale = await w.uc.getSharedStatus(EVENT);
    expect(stale.status).toBe("ready");

    // New lineup: drop 5 headliners, add 3 new ones.
    const added = seedArtists(w, 3, "headliner", 10, 50, "newhead");
    w.events.put(wholePoolShow(makeEvent(EVENT, [...original.slice(5), ...added], "hash-2")));
    expect(await w.uc.getSharedStatus(EVENT)).toMatchObject({ status: "ready", stale: true });
    const before = w.writer.calls.length;
    const r = await w.uc.startSharedBuild(EVENT, "ip");
    expect(r.status).toBe("building");
    if (r.status !== "building") return;
    const during = await w.uc.getSharedStatus(EVENT);
    expect(during).toMatchObject({ status: "building", url: expect.stringContaining(firstId) });
    await runToEnd(w, r.jobId);
    expect(w.writer.count("create")).toBe(1);
    expect(w.shared.rows.get(EVENT)!.spotifyPlaylistId).toBe(firstId);
    const rebuild = w.writer.calls.slice(before);
    expect(rebuild[0]!.kind).toBe("replace");
    expect(rebuild.slice(1).every((c) => c.kind === "add")).toBe(true);
    expect(rebuild.every((c) => c.n <= 100)).toBe(true);
    const pl = playlistOf(w);
    expect(pl).toHaveLength(230);
    expect(new Set(pl).size).toBe(230);
    expect(pl.some((t) => t.includes("headliner0x"))).toBe(false); // dropped artist's songs are gone
    expect(w.shared.rows.get(EVENT)!.lineupHashAtBuild).toBe("hash-2");
    expect(await w.uc.getSharedStatus(EVENT)).toMatchObject({ status: "ready", stale: false });
  });

  // Ambiguity (reported): the spec doesn't say whether a rebuild that finds no songs should clear
  // the playlist or fail and keep the old songs. Either is accepted here, but it must be clean.
  it("rebuild to a lineup with 0 songs either clears the items or fails cleanly keeping the old ones", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10), "hash-1"));
    await runToEnd(w, await start());
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 0, 9, "silent"), "hash-2"));
    const r = await w.uc.startSharedBuild(EVENT, "ip");
    expect(r.status).toBe("building");
    const res = r.status === "building" ? await runToEnd(w, r.jobId) : null;
    if (res?.last.status === "failed") {
      expect(res.last.error).toBeTruthy();
      expect(playlistOf(w)).toHaveLength(10);
      expect(await w.uc.getSharedStatus(EVENT)).toMatchObject({ status: "ready", stale: true });
    } else expect(playlistOf(w)).toHaveLength(0);
  });

  it("a lineup change mid-build restarts selection with the new lineup", async () => {
    const original = seedArtists(w, 20, "headliner", 10);
    w.events.put(makeEvent(EVENT, original, "hash-1"));
    w.tracks.onSearch = () => w.clock.advance(1_000);
    const id = await start();
    await w.uc.step(id);
    const added = seedArtists(w, 1, "headliner", 10, 99, "late");
    w.events.put(makeEvent(EVENT, [...original, ...added], "hash-2"));
    w.clock.advance(1_500);
    const { last } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    const pl = playlistOf(w);
    expect(pl.some((t) => t.includes("late0x"))).toBe(true);
    expect(new Set(pl).size).toBe(pl.length);
    expect(w.shared.rows.get(EVENT)!.lineupHashAtBuild).toBe("hash-2");
  });
});

describe("QA leases and crash recovery (D-005)", () => {
  it("two simultaneous steps: only one does work", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 3, "headliner", 10)));
    const id = await start();
    const [a, b] = await Promise.all([w.uc.step(id), w.uc.step(id)]);
    expect([a, b].every((p) => p.jobId === id)).toBe(true);
    expect(w.writer.count("create")).toBeLessThanOrEqual(1);
    await runToEnd(w, id);
    expect(w.writer.count("create")).toBe(1);
    expect(playlistOf(w)).toHaveLength(30);
  });

  it("a step killed mid-chunk resumes without duplicate tracks", async () => {
    // D-065: a long show, so all 250 seeded songs fit (three write chunks).
    w.events.put(wholePoolShow(makeEvent(EVENT, seedArtists(w, 25, "headliner", 10))));
    const id = await start();
    // Spotify accepts write #2, then the process dies before the checkpoint is saved.
    w.writer.after = (_k, _ids, no) => (no === 2 ? never() : undefined);
    let p: BuildProgress | undefined;
    for (
      let i = 0;
      i < 50 && w.writer.calls.filter((c) => c.kind !== "create").length < 2;
      i += 1
    ) {
      void w.uc.step(id).then((x) => (p = x));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      if (w.writer.calls.filter((c) => c.kind !== "create").length < 2) w.clock.advance(1_500);
    }
    void p;
    expect(w.writer.calls.filter((c) => c.kind !== "create").length).toBeGreaterThanOrEqual(2);
    w.writer.after = undefined;
    w.clock.advance(LEASE_MS + 1);
    const { last } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    const pl = playlistOf(w);
    expect(new Set(pl).size).toBe(pl.length);
    expect(pl).toHaveLength(250);
  });

  // Lead (D-046): accepted residual risk. This fake models a write that can never be cancelled and
  // outlives the lease. In production every request times out at 4s and a write starts only with at
  // least 13s of the 15s lease left, so a write cannot outlive its lease. Kept as documentation.
  it.skip("a stale step that wakes up after losing its lease does not write again", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 25, "headliner", 10)));
    const id = await start();
    let wake: () => void = () => {};
    w.writer.before = (_k, _ids, no) =>
      no === 1 ? new Promise<void>((r) => (wake = r)) : undefined;
    const stale = w.uc.step(id);
    await vi.waitFor(() => expect(w.writer.count("create")).toBe(1));
    await new Promise((r) => setImmediate(r));
    w.writer.before = undefined;
    w.clock.advance(LEASE_MS + 1);
    const { last } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    const writesAfterFinish = w.writer.calls.length;
    wake();
    await stale.catch(() => undefined);
    // The woken step may complete the one call it was already inside, but nothing more.
    expect(w.writer.calls.length - writesAfterFinish).toBeLessThanOrEqual(1);
    const pl = playlistOf(w);
    // BUG (QA-P-3, low): a write that was in flight when the lease expired lands after the new
    // step finished: calls are create,replace:100,add:100,add:50 then the stale replace:100, which
    // cuts the finished 250-song playlist to 100. Needs a per-request timeout well under LEASE_MS
    // (or a post-finish verification), since an in-flight request can't be recalled.
    expect(new Set(pl).size).toBe(pl.length);
    expect(pl).toHaveLength(250);
  });
});

describe("QA Spotify pauses and auth (D-006, D-020, LLD §7.3)", () => {
  it("short pause (≤30 s) keeps the job running and returns resumeAfter", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 2, "headliner", 10)));
    const id = await start();
    let thrown = false;
    w.tracks.onSearch = () => {
      if (!thrown) {
        thrown = true;
        throw new SpotifyBlockedError("gate_paused", new Date(w.clock.t + 10_000));
      }
    };
    const p = await w.uc.step(id);
    expect(p.status).toBe("running");
    expect(p.resumeAfter).toBeDefined();
    expect(SHORT_PAUSE_MS).toBe(30_000);
    const { last } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    expect(playlistOf(w)).toHaveLength(20);
  });

  it("QUOTA_EXCEEDED mid-build → paused with resume_after; no work before it; resumes after", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 4, "headliner", 10)));
    const id = await start();
    const until = new Date(w.clock.t + 3600_000);
    let n = 0;
    w.tracks.onSearch = () => {
      n += 1;
      if (n === 3) throw new SpotifyBlockedError("quota_exceeded", until);
    };
    const p = await w.uc.step(id);
    expect(p.status).toBe("paused");
    expect(new Date(p.resumeAfter!).getTime()).toBe(until.getTime());
    const stored = w.jobs.jobs.get(id)!;
    expect(stored.status).toBe("paused");
    expect(stored.resumeAfter?.getTime()).toBe(until.getTime());
    const searches = w.tracks.searches.length;
    w.clock.advance(60_000);
    const again = await w.uc.step(id);
    expect(again.status).toBe("paused");
    expect(w.tracks.searches.length).toBe(searches);
    expect(again.progress).toBeGreaterThanOrEqual(p.progress);
    w.clock.set(new Date(until.getTime() + 1));
    const { last } = await runToEnd(w, id);
    expect(FINISHED).toContain(last.status);
    expect(new Set(playlistOf(w)).size).toBe(40);
  });

  it("QUOTA_EXCEEDED while writing chunks pauses and later finishes with no duplicates", async () => {
    // D-065: a long show, so all 250 seeded songs fit (three write chunks).
    w.events.put(wholePoolShow(makeEvent(EVENT, seedArtists(w, 25, "headliner", 10))));
    const id = await start();
    const until = new Date(w.clock.t + 2 * 3600_000);
    w.writer.before = (_k, _ids, no) => {
      if (no === 2) throw new SpotifyBlockedError("quota_exceeded", until);
    };
    const { last, seen } = await runToEnd(w, id);
    expect(seen.some((p) => p.status === "paused")).toBe(true);
    expect(FINISHED).toContain(last.status);
    const pl = playlistOf(w);
    expect(pl).toHaveLength(250);
    expect(new Set(pl).size).toBe(250);
  });

  it("reauth while creating → failed with a friendly message (no internals, no tokens)", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const id = await start();
    w.writer.createError = new ReauthRequiredError();
    const { last } = await runToEnd(w, id);
    expect(last.status).toBe("failed");
    expect(last.error).toBeTruthy();
    expect(last.error).toContain(UNAVAILABLE_MESSAGE);
    expect(last.error).not.toMatch(/invalid_grant|stack|Error:|token/i);
    // a new start is refused cleanly (publisher needs reauth now) or starts a fresh job
    expect(w.jobs.jobs.get(id)!.status).toBe("failed");
  });

  it("publisher reauth discovered at step time → failed, not stuck", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const id = await start();
    w.pub.token = "reauth";
    const { last } = await runToEnd(w, id, 20);
    expect(last.status).toBe("failed");
    expect(last.error).toContain(UNAVAILABLE_MESSAGE);
    expect(w.writer.calls).toHaveLength(0);
  });

  it("after a failed build, a new start creates a fresh job (no stuck event)", async () => {
    w.events.put(makeEvent(EVENT, seedArtists(w, 1, "headliner", 10)));
    const id = await start();
    w.writer.createError = new ReauthRequiredError();
    await runToEnd(w, id);
    w.writer.createError = undefined;
    const next = await start();
    expect(next).not.toBe(id);
    const { last } = await runToEnd(w, next);
    expect(FINISHED).toContain(last.status);
  });
});

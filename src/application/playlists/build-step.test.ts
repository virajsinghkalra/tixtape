import { describe, expect, it } from "vitest";
import { ReauthRequiredError, SpotifyBlockedError } from "@/application/ports/spotify";
import type { EventDetail } from "@/application/ports/events";
import type { BillingTier } from "@/domain/shared/lineup";
import type { PlaylistJobId } from "@/domain/shared/ids";
import { RateLimitedError, UpstreamError } from "@/lib/errors";
import { UNIT_START_LIMIT_MS, WRITE_LEASE_MARGIN_MS } from "./build-step";
import { NoMatchedArtistsError, PlaylistUnavailableError, UNAVAILABLE_MESSAGE } from "./errors";
import { PUBLISHER_ID, playlistWorld } from "./testing/fakes";

type World = ReturnType<typeof playlistWorld>;

/** A festival; without `over` it has no end time, so it's one default 8 h day (D-065). */
function festival(
  w: World,
  acts: [string, BillingTier, boolean?][],
  over: Partial<EventDetail> = {},
) {
  return w.events.add(
    acts.map(([name, tier, matched = true]) => ({
      name,
      tier,
      spotifyId: matched ? w.spotify.addArtist(name).id : null,
    })),
    over,
  );
}

/** One hour of music: start and end on the same day. */
const ONE_HOUR = {
  startsAt: new Date("2026-12-05T10:00:00Z"),
  endsAt: new Date("2026-12-05T11:00:00Z"),
};
const SONG_MS = 200_000; // every fake track

async function start(w: World, eventId = [...w.events.rows.keys()][0]!) {
  const r = await w.useCases.startSharedBuild(eventId, "1.2.3.4");
  if (r.status !== "building") throw new Error(`expected building, got ${r.status}`);
  return r.jobId;
}

/** Steps like the browser does, waiting out any `resumeAfter`. */
async function runToEnd(w: World, jobId: PlaylistJobId, maxSteps = 200) {
  for (let i = 0; i < maxSteps; i++) {
    const p = await w.useCases.step(jobId);
    if (!["queued", "running", "paused"].includes(p.status)) return p;
    if (p.resumeAfter) w.clock.advance(p.resumeAfter.getTime() - w.clock.now().getTime() + 1);
  }
  throw new Error("job did not finish");
}

/** `n` headliners with 12 songs each; a default 8 h day gives each more time than their pool. */
const bigLineupOf = (w: World, n: number) =>
  festival(
    w,
    Array.from({ length: n }, (_, i): [string, BillingTier] => [`Act ${i}`, "headliner"]),
  );

const onlyPlaylist = (w: World) => {
  expect(w.spotify.playlists.size).toBe(1);
  return [...w.spotify.playlists.values()][0]!;
};

describe("shared build: happy path", () => {
  it("builds one public playlist in tier order, skipping unmatched artists", async () => {
    const w = playlistWorld();
    const event = festival(
      w,
      [
        ["Ritviz", "headliner"],
        ["Nucleya", "headliner"],
        ["Seedhe Maut", "sub"],
        ["Unknown Act", "mid", false],
        ["Kayan", "support"],
      ],
      ONE_HOUR,
    );
    const jobId = await start(w);
    const done = await runToEnd(w, jobId);

    expect(done).toMatchObject({
      status: "partial",
      stage: "done",
      progress: 100,
      artistsDone: 4,
      artistsTotal: 4,
      unresolved: ["Unknown Act"],
      playlistUrl: "https://open.spotify.com/playlist/pl1",
    });
    const items = onlyPlaylist(w);
    expect(new Set(items).size).toBe(items.length);
    // D-065: the playlist fills the 60-minute show, every matched artist gets ≥ 2 songs, and
    // time follows billing (headliner > sub > support).
    const count = (prefix: string) => items.filter((id) => id.startsWith(prefix)).length;
    const [ritviz, nucleya, seedhe, kayan] = ["Ritviz", "Nucleya", "SeedheMaut", "Kayan"].map(
      count,
    );
    expect(Math.min(ritviz!, nucleya!, seedhe!, kayan!)).toBeGreaterThanOrEqual(2);
    expect(ritviz).toBeGreaterThan(seedhe!);
    expect(seedhe).toBeGreaterThanOrEqual(kayan!);
    const minutes = (items.length * SONG_MS) / 60_000;
    expect(Math.abs(minutes - 60)).toBeLessThanOrEqual((4 * SONG_MS) / 2 / 60_000);
    // D-040: headliners interleaved first, support last.
    const artistOf = (id: string) => id.replace(/T\d+$/u, "");
    expect(items.slice(0, 4).map(artistOf)).toEqual(["Ritviz", "Nucleya", "Ritviz", "Nucleya"]);
    expect(items.slice(-2).every((id) => id.startsWith("Kayan"))).toBe(true);

    const row = w.shared.rows.get(event.id)!;
    expect(row).toMatchObject({ lineupHashAtBuild: "hash-1", trackIds: items });
    await expect(w.useCases.startSharedBuild(event.id, "5.6.7.8")).resolves.toEqual({
      status: "ready",
      url: row.url,
    });
  });

  it("succeeds when every artist resolves, and stays within the step budget", async () => {
    const w = playlistWorld({ callMs: 3_000 });
    festival(w, [
      ["Ritviz", "headliner"],
      ["Prateek Kuhad", "sub"],
      ["Kayan", "mid"],
    ]);
    const jobId = await start(w);
    const first = await w.useCases.step(jobId);
    expect(first).toMatchObject({ status: "running", stage: "select" });
    expect(first.artistsDone).toBeLessThan(3);
    expect(first.progress).toBeGreaterThan(0);
    expect(first.progress).toBeLessThan(80);
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("maps Last.fm and chart titles to Spotify and puts them first", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    w.signals.top.set("Ritviz", [
      { title: "Ritviz Song 11", playcount: 900, listeners: 10 },
      { title: "Not On Spotify", playcount: 800, listeners: 10 },
      { title: "Ritviz Song 3 (Live)", playcount: 700, listeners: 10 },
    ]);
    w.signals.chartEntries = [
      { title: "Other Hit", artistName: "Someone Else", rank: 1 },
      { title: "Ritviz Song 10", artistName: "Ritviz & Friends", rank: 3 },
      { title: "Ritviz Song 9", artistName: "Ritviz x Nucleya", rank: 2 },
    ];
    await runToEnd(w, await start(w));
    // Most-listened (mapped), then trending by chart rank, then newest, then search order.
    expect(onlyPlaylist(w).slice(0, 3)).toEqual(["RitvizT11", "RitvizT3", "RitvizT9"]);
  });

  it("still builds when Last.fm and Apple are down", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    w.signals.topTracks = async () => {
      throw new UpstreamError("lastfm", "down");
    };
    w.signals.chart = async () => {
      throw new UpstreamError("apple", "down");
    };
    await expect(runToEnd(w, await start(w))).resolves.toMatchObject({ status: "succeeded" });
    expect(onlyPlaylist(w)).toHaveLength(12);
  });
});

describe("shared build: crash safety and concurrency", () => {
  const bigLineup = (w: World) => bigLineupOf(w, 12);

  it("resumes after a step dies mid-chunk without duplicating tracks", async () => {
    const w = playlistWorld();
    bigLineup(w);
    const jobId = await start(w);
    // The second chunk (an append) lands on Spotify, then the step dies before checkpointing.
    w.spotify.failNext("add", new Error("killed"), { afterEffect: true });
    await expect(runToEnd(w, jobId)).rejects.toThrow("killed");
    w.jobs.expireLeases();

    const done = await runToEnd(w, jobId);
    expect(done.status).toBe("succeeded");
    const items = onlyPlaylist(w);
    expect(items).toHaveLength(144);
    expect(new Set(items).size).toBe(144);
    expect(w.spotify.calls.filter((c) => c === "create")).toHaveLength(1);
  });

  it("resumes after a step dies right after creating the playlist row", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    w.spotify.failNext("replace", new Error("killed"));
    await expect(runToEnd(w, jobId)).rejects.toThrow("killed");
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
    expect(onlyPlaylist(w)).toHaveLength(12);
  });

  it("two concurrent steps never create two playlists or repeat tracks", async () => {
    const w = playlistWorld();
    bigLineup(w);
    const jobId = await start(w);
    let skipped = 0;
    for (let i = 0; i < 100; i++) {
      const before = w.spotify.calls.length;
      const [a, b] = await Promise.all([w.useCases.step(jobId), w.useCases.step(jobId)]);
      if (w.spotify.calls.length === before || a.progress !== b.progress) skipped++;
      if (a.status === "succeeded" && b.status === "succeeded") break;
    }
    expect(skipped).toBeGreaterThan(0);
    expect(w.spotify.calls.filter((c) => c === "create")).toHaveLength(1);
    const items = onlyPlaylist(w);
    expect(items).toHaveLength(144);
    expect(new Set(items).size).toBe(144);
  });

  it("joins the active build instead of starting a second one", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    const [a, b] = await Promise.all([
      w.useCases.startSharedBuild(event.id, "1.1.1.1"),
      w.useCases.startSharedBuild(event.id, "2.2.2.2"),
    ]);
    expect(a).toEqual(b);
    expect(w.jobs.rows.size).toBe(1);
  });
});

describe("shared build: Spotify pauses and reauth", () => {
  it("a short gate pause keeps the job running and the next step retries", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    const until = new Date(w.clock.now().getTime() + 10_000);
    w.spotify.failNext("search", new SpotifyBlockedError("gate_paused", until));

    const p = await w.useCases.step(jobId);
    expect(p).toMatchObject({ status: "running", resumeAfter: until, artistsDone: 0 });
    const calls = w.spotify.calls.length;
    await expect(w.useCases.step(jobId)).resolves.toMatchObject({ status: "running" });
    expect(w.spotify.calls.length).toBe(calls); // no work before resumeAfter
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
  });

  it.each(["quota_exceeded", "long_retry_after", "gate_paused"] as const)(
    "a long %s pause marks the job paused until resume_after",
    async (reason) => {
      const w = playlistWorld();
      festival(w, [["Ritviz", "headliner"]]);
      const jobId = await start(w);
      const until = new Date(w.clock.now().getTime() + 3_600_000);
      w.spotify.failNext("search", new SpotifyBlockedError(reason, until));

      await expect(w.useCases.step(jobId)).resolves.toMatchObject({
        status: "paused",
        resumeAfter: until,
      });
      w.clock.advance(60_000);
      await expect(w.useCases.step(jobId)).resolves.toMatchObject({ status: "paused" });
      await expect(w.useCases.getSharedStatus([...w.events.rows.keys()][0]!)).resolves.toEqual({
        status: "building",
        jobId,
      });
      w.clock.advance(3_600_000);
      await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
    },
  );

  it("fails with the unavailable message when the publisher must reauth mid-build", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    w.spotify.failNext("create", new ReauthRequiredError());
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({
      status: "failed",
      error: UNAVAILABLE_MESSAGE,
    });
    // A failed job frees the event: the next start makes a new job once things are healthy.
    const again = await start(w);
    expect(again).not.toBe(jobId);
  });

  it("fails a queued job when the publisher was disconnected", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    w.tokens.add(PUBLISHER_ID, true);
    await expect(w.useCases.step(jobId)).resolves.toMatchObject({
      status: "failed",
      error: UNAVAILABLE_MESSAGE,
    });
  });
});

describe("startSharedBuild guards", () => {
  it("refuses when no artist is matched", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Nobody", "headliner", false]]);
    await expect(w.useCases.startSharedBuild(event.id, "ip")).rejects.toBeInstanceOf(
      NoMatchedArtistsError,
    );
  });

  it.each([
    ["no publisher", (w: World) => (w.publisher.row = null)],
    ["publisher needs reauth", (w: World) => w.tokens.add(PUBLISHER_ID, true)],
  ])("is unavailable with %s", async (_n, breakIt) => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    breakIt(w);
    await expect(w.useCases.startSharedBuild(event.id, "ip")).rejects.toBeInstanceOf(
      PlaylistUnavailableError,
    );
  });

  it("rate limits new builds per client but not reads of ready playlists", async () => {
    const w = playlistWorld({ startsPerHour: 1 });
    const one = festival(w, [["Ritviz", "headliner"]]);
    const two = w.events.add([
      { name: "Ritviz", tier: "headliner", spotifyId: one.lineup[0]!.spotifyId },
    ]);
    await runToEnd(w, await start(w, one.id));
    await expect(w.useCases.startSharedBuild(two.id, "1.2.3.4")).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    await expect(w.useCases.startSharedBuild(two.id, "9.9.9.9")).resolves.toMatchObject({
      status: "building",
    });
    await expect(w.useCases.startSharedBuild(one.id, "1.2.3.4")).resolves.toMatchObject({
      status: "ready",
    });
  });
});

describe("lineup changes", () => {
  it("rebuilds into the same playlist and reports stale until then", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    await expect(w.useCases.getSharedStatus(event.id)).resolves.toEqual({ status: "none" });
    await runToEnd(w, await start(w));
    const built = w.shared.rows.get(event.id)!;

    const kayan = w.spotify.addArtist("Kayan");
    const stored = w.events.rows.get(event.id)!;
    stored.lineupHash = "hash-2";
    stored.lineup.push({
      ...stored.lineup[0]!,
      name: "Kayan",
      spotifyId: kayan.id,
      tier: "support",
      billingRank: 2,
    });

    await expect(w.useCases.getSharedStatus(event.id)).resolves.toMatchObject({
      status: "ready",
      stale: true,
    });
    const jobId = await start(w);
    await expect(w.useCases.getSharedStatus(event.id)).resolves.toEqual({
      status: "building",
      jobId,
      url: built.url,
    });
    await runToEnd(w, jobId);

    const items = onlyPlaylist(w);
    expect(items).toHaveLength(24); // two artists, 4 h each, more than both pools (D-065 cap)
    expect(w.spotify.calls.filter((c) => c === "create")).toHaveLength(1);
    expect(w.shared.rows.get(event.id)).toMatchObject({
      spotifyPlaylistId: built.spotifyPlaylistId,
      lineupHashAtBuild: "hash-2",
      trackIds: items,
    });
    await expect(w.useCases.getSharedStatus(event.id)).resolves.toMatchObject({
      status: "ready",
      stale: false,
    });
  });

  it("restarts selection when the lineup changes mid-build", async () => {
    const w = playlistWorld({ callMs: 3_000 });
    const event = festival(w, [
      ["Ritviz", "headliner"],
      ["Kayan", "sub"],
      ["Nucleya", "mid"],
    ]);
    const jobId = await start(w);
    await w.useCases.step(jobId);
    const stored = w.events.rows.get(event.id)!;
    stored.lineupHash = "hash-2";
    stored.lineup = stored.lineup.slice(0, 1);
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({ artistsTotal: 1 });
    expect(onlyPlaylist(w)).toHaveLength(12);
    expect(w.shared.rows.get(event.id)?.lineupHashAtBuild).toBe("hash-2");
  });
});

describe("progress reads", () => {
  it("getProgress does no work and 404s unknown jobs", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    await expect(w.useCases.getProgress(jobId)).resolves.toMatchObject({
      status: "queued",
      progress: 0,
    });
    expect(w.spotify.calls).toHaveLength(0);
    await expect(
      w.useCases.getProgress("00000000-0000-4000-8000-999999999999" as PlaylistJobId),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("D-045 rules", () => {
  it("a rebuild that finds no songs keeps the old playlist and reports it stale", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    await runToEnd(w, await start(w));
    const before = [...onlyPlaylist(w)];

    const stored = w.events.rows.get(event.id)!;
    stored.lineupHash = "hash-2";
    stored.lineup[0]!.spotifyId = w.spotify.addArtist("Silent Act", 0).id;
    const done = await runToEnd(w, await start(w));

    expect(done).toMatchObject({ status: "failed" });
    expect(onlyPlaylist(w)).toEqual(before);
    expect(w.shared.rows.get(event.id)).toMatchObject({ lineupHashAtBuild: "hash-1" });
    await expect(w.useCases.getSharedStatus(event.id)).resolves.toMatchObject({
      status: "ready",
      stale: true,
    });
  });

  it("starts every Spotify write with at least WRITE_LEASE_MARGIN_MS of lease left", async () => {
    const w = playlistWorld({ callMs: 1_500 });
    bigLineupOf(w, 4);
    const jobId = await start(w);
    let lease: Date | null = null;
    const claim = w.jobs.claim.bind(w.jobs);
    w.jobs.claim = async (id, ms) => {
      const got = await claim(id, ms);
      lease = got?.lease.lockedUntil ?? lease;
      return got;
    };
    const left: number[] = [];
    for (const op of ["createPlaylist", "replaceItems", "addItems"] as const) {
      const original = w.spotify[op].bind(w.spotify) as (...a: never[]) => Promise<never>;
      (w.spotify as unknown as Record<string, unknown>)[op] = (...a: never[]) => {
        left.push(lease!.getTime() - w.clock.now().getTime());
        return original(...a);
      };
    }
    await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
    expect(left.length).toBeGreaterThan(0);
    for (const ms of left) expect(ms).toBeGreaterThanOrEqual(WRITE_LEASE_MARGIN_MS);
  });

  it("a step that lost its lease does not start another write", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    const claim = w.jobs.claim.bind(w.jobs);
    // Another step takes the job over right after this one claims it.
    w.jobs.claim = async (id, ms) => {
      const got = await claim(id, ms);
      w.jobs.expireLeases();
      w.clock.advance(1);
      await claim(id, ms);
      return got;
    };
    await w.useCases.step(jobId);
    expect(w.spotify.calls).toEqual([]);
  });

  it("warns about a missing publisher at most once a minute", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    w.publisher.row = null;
    const attempt = () => w.useCases.startSharedBuild(event.id, "ip").catch(() => undefined);
    await attempt();
    await attempt();
    expect(w.warnings).toHaveLength(1);
    expect(w.warnings[0]?.[0]).toEqual({ problem: "not_connected" });
    w.clock.advance(60_000);
    await attempt();
    expect(w.warnings).toHaveLength(2);
  });
});

describe("Lead bug reports", () => {
  it("a failed (cancelled) job does no work when the page keeps stepping", async () => {
    const w = playlistWorld();
    festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    w.jobs.rows.get(jobId)!.status = "failed";
    const p = await w.useCases.step(jobId);
    expect(p).toMatchObject({ status: "failed", progress: 0, stage: null });
    expect(w.spotify.calls).toEqual([]);
  });

  it("a job cancelled while a step is running stays cancelled", async () => {
    const w = playlistWorld({ callMs: 1_000 });
    bigLineupOf(w, 6);
    const jobId = await start(w);
    const search = w.spotify.searchTracks.bind(w.spotify);
    w.spotify.searchTracks = async (...args) => {
      w.jobs.rows.get(jobId)!.status = "failed"; // the admin cancels mid-step
      return search(...args);
    };
    const p = await w.useCases.step(jobId);
    expect(p.status).toBe("failed");
    expect(w.jobs.rows.get(jobId)).toMatchObject({ status: "failed", artistsDone: 0 });
    const calls = w.spotify.calls.length;
    await expect(w.useCases.step(jobId)).resolves.toMatchObject({ status: "failed" });
    expect(w.spotify.calls.length).toBe(calls);
  });

  it.each([
    ["slow Spotify", 1_000, 0],
    ["slow Last.fm", 100, 2_000],
  ])("every step ends near the budget with %s", async (_n, spotifyMs, signalMs) => {
    const w = playlistWorld({ callMs: spotifyMs });
    w.signals.callMs = signalMs;
    bigLineupOf(w, 8);
    for (const a of w.spotify.artists) {
      w.signals.top.set(
        a.name,
        a.tracks.map((t, i) => ({ title: t.name, playcount: 1000 - i, listeners: 1 })),
      );
    }
    const jobId = await start(w);
    const longestUnit = 3 * Math.max(spotifyMs, signalMs);
    for (let i = 0; i < 300; i++) {
      const before = w.clock.now().getTime();
      const p = await w.useCases.step(jobId);
      expect(w.clock.now().getTime() - before).toBeLessThanOrEqual(
        UNIT_START_LIMIT_MS + longestUnit,
      );
      if (p.status === "succeeded") return;
    }
    throw new Error("did not finish");
  });
});

describe("D-065 plan in the build", () => {
  it("a single-artist 150-minute concert gets about 40 songs", async () => {
    const w = playlistWorld();
    const diljit = w.spotify.addArtist("Diljit Dosanjh", 80, 225_000);
    w.events.add([{ name: "Diljit Dosanjh", tier: "headliner", spotifyId: diljit.id }], {
      type: "concert",
      startsAt: new Date("2026-12-05T14:00:00Z"),
      endsAt: null,
    });
    await expect(runToEnd(w, await start(w))).resolves.toMatchObject({ status: "succeeded" });
    expect(onlyPlaylist(w)).toHaveLength(40);
  });

  it("extends a short signal pool with album tracks by recency", async () => {
    const w = playlistWorld();
    const big = w.spotify.addArtist("Big Act", 40);
    w.events.add([{ name: "Big Act", tier: "headliner", spotifyId: big.id }], {
      type: "concert",
      endsAt: null,
    });
    await runToEnd(w, await start(w));
    // 150 min / 200 s songs = 45 songs wanted; the artist search alone gives 10.
    const items = onlyPlaylist(w);
    expect(items.length).toBeGreaterThan(30);
    expect(w.spotify.calls.filter((c) => c === "albumTracks").length).toBeGreaterThan(1);
  });

  it("uses popularity to share time within a tier", async () => {
    const w = playlistWorld();
    festival(
      w,
      [
        ["Famous", "sub"],
        ["Niche", "sub"],
        ["Filler A", "support"],
        ["Filler B", "support"],
      ],
      ONE_HOUR,
    );
    w.signals.fans.set("Famous", 2_000_000);
    w.signals.fans.set("Niche", 1_000);
    await runToEnd(w, await start(w));
    const items = onlyPlaylist(w);
    const count = (p: string) => items.filter((id) => id.startsWith(p)).length;
    expect(count("Famous")).toBeGreaterThan(count("Niche"));
  });

  it("estimatePlaylist previews the same plan the build fills", async () => {
    const w = playlistWorld();
    const event = festival(
      w,
      [
        ["Ritviz", "headliner"],
        ["Seedhe Maut", "sub"],
        ["Kayan", "support"],
        ["Nobody", "mid", false],
      ],
      ONE_HOUR,
    );
    // 10/5/1 of 60 min: the headliner and then the sub hit the 40% cap (24 min).
    await expect(w.useCases.estimatePlaylist(event.id)).resolves.toEqual({
      songs: 15,
      minutes: 60,
      showMinutes: 60,
      days: 1,
      unmatched: 1,
      perTier: [
        { tier: "headliner", artists: 1, songs: 6, minutes: 24 },
        { tier: "sub", artists: 1, songs: 6, minutes: 24 },
        { tier: "support", artists: 1, songs: 3, minutes: 12 },
      ],
    });
    await runToEnd(w, await start(w));
    const items = onlyPlaylist(w);
    expect(Math.abs((items.length * SONG_MS) / 60_000 - 60)).toBeLessThanOrEqual(5);
  });
});

describe("D-070", () => {
  it.each([
    ["behind", -3_600_000],
    ["ahead", 3_600_000],
  ])(
    "writes on time when the database clock is an hour %s of the app clock",
    async (_n, skewMs) => {
      const w = playlistWorld();
      festival(w, [["Ritviz", "headliner"]]);
      const jobId = await start(w);
      const claim = w.jobs.claim.bind(w.jobs);
      w.jobs.claim = async (id, ms) => {
        const got = await claim(id, ms);
        if (!got) return got;
        // The DB stamped locked_until with its own (skewed) clock.
        const skewed = new Date(got.lease.lockedUntil.getTime() + skewMs);
        w.jobs.rows.get(id)!.lockedUntil = skewed;
        return { ...got, lease: { ...got.lease, lockedUntil: skewed } };
      };
      await expect(runToEnd(w, jobId)).resolves.toMatchObject({ status: "succeeded" });
      expect(onlyPlaylist(w)).toHaveLength(12);
    },
  );

  it("an archived (unpublished) event can't start a build, and its job does no work", async () => {
    const w = playlistWorld();
    const event = festival(w, [["Ritviz", "headliner"]]);
    const jobId = await start(w);
    const stored = w.events.rows.get(event.id)!;
    w.events.rows.delete(event.id); // public reads now 404, as for an archived event (D-058)
    await expect(w.useCases.startSharedBuild(event.id, "ip")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(w.useCases.step(jobId)).rejects.toMatchObject({ code: "not_found" });
    expect(w.spotify.calls).toEqual([]);
    w.events.rows.set(event.id, stored);
  });
});

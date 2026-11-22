import { describe, expect, it } from "vitest";
import {
  activeJob,
  afterFailedStep,
  refreshView,
  MAX_STALLED_STEPS,
  formatClock,
  nextStepDelay,
  stageLabel,
  viewFromStart,
  viewFromStatus,
  viewFromStep,
  type PlaylistView,
} from "./playlist-state";

const URL_ = "https://open.spotify.com/playlist/abc";
const step = (over: Record<string, unknown>) => ({
  jobId: "j",
  status: "running",
  stage: "select",
  progress: 30,
  artistsDone: 8,
  artistsTotal: 13,
  unresolved: [],
  ...over,
});
const building: PlaylistView = {
  kind: "building",
  joined: false,
  jobId: "j",
  progress: 0,
  label: "",
  waitUntil: null,
  stalled: 0,
};

describe("viewFromStatus (GET)", () => {
  it("none, building (join), ready, ready+stale, garbage", () => {
    expect(viewFromStatus({ status: "none" })).toEqual({ kind: "idle" });
    expect(viewFromStatus({ status: "building", jobId: "j1" })).toMatchObject({
      kind: "building",
      joined: true,
      jobId: "j1",
    });
    expect(
      viewFromStatus({ status: "ready", url: URL_, builtAt: "2026-11-21T10:00:00Z" }),
    ).toMatchObject({
      kind: "ready",
      builtAt: "2026-11-21T10:00:00Z",
      refresh: null,
    });
    expect(viewFromStatus({ status: "ready", url: URL_, stale: true })).toMatchObject({
      refresh: "pending",
    });
    expect(viewFromStatus({ nonsense: true })).toEqual({ kind: "idle" });
  });
});

describe("viewFromStart (POST)", () => {
  it("ready and building", () => {
    expect(viewFromStart(200, { status: "ready", url: URL_ }, null)).toMatchObject({
      kind: "ready",
      justMade: true,
    });
    expect(viewFromStart(202, { status: "building", jobId: "j" }, null)).toMatchObject({
      kind: "building",
      joined: false,
    });
  });

  it("maps 503, 422, 429 and anything else to friendly states", () => {
    expect(viewFromStart(503, {}, null)).toEqual({ kind: "unavailable" });
    expect(viewFromStart(422, {}, null)).toMatchObject({
      message: "Playlist soon ⏳",
    });
    expect(viewFromStart(429, {}, "120")).toMatchObject({
      message: expect.stringContaining("2 min"),
    });
    expect(viewFromStart(500, { error: { message: "boom" } }, null)).toMatchObject({
      kind: "problem",
      message: expect.not.stringContaining("boom"),
    });
  });
});

describe("viewFromStep", () => {
  it("names each stage while building", () => {
    expect(viewFromStep(step({}), building)).toMatchObject({
      kind: "building",
      label: "Picking songs…",
    });
  });

  it("finishes with confetti for a first build, listing skipped artists when partial", () => {
    expect(
      viewFromStep(
        step({ status: "partial", progress: 100, playlistUrl: URL_, unresolved: ["A", "B"] }),
        building,
      ),
    ).toMatchObject({
      kind: "ready",
      justMade: true,
      skipped: ["A", "B"],
    });
  });

  it("a refresh of a stale playlist keeps it open and shows progress, without confetti at the end", () => {
    const stale: PlaylistView = {
      kind: "ready",
      url: URL_,
      builtAt: null,
      justMade: false,
      skipped: [],
      refresh: "pending",
    };
    const mid = viewFromStep(step({}), stale);
    expect(mid).toMatchObject({
      kind: "ready",
      refresh: { label: "Picking songs…" },
    });
    expect(
      viewFromStep(step({ status: "succeeded", progress: 100, playlistUrl: URL_ }), mid),
    ).toMatchObject({
      kind: "ready",
      justMade: false,
      refresh: null,
    });
  });

  it("paused keeps polling until resumeAfter", () => {
    const v = viewFromStep(
      step({ status: "paused", resumeAfter: "2026-11-21T13:10:00Z" }),
      building,
    );
    const job = activeJob(v)!;
    expect(job.waitUntil).toBe("2026-11-21T13:10:00Z");
    expect(nextStepDelay(job, new Date("2026-11-21T13:09:30Z"))).toBe(30_000);
    expect(formatClock("2026-11-21T13:10:00Z")).toBe("6:40 pm");
  });

  it("a failed first build shows one tiny message (D-082), not the job's error text", () => {
    expect(
      viewFromStep(step({ status: "failed", error: "Spotify is down" }), building),
    ).toMatchObject({
      kind: "problem",
      message: "Oops. Try again.",
    });
  });
});

describe("stageLabel", () => {
  it.each([
    [{ status: "queued", stage: null, progress: 0, artistsDone: 0, artistsTotal: 0 }, "Matching…"],
    [
      { status: "running", stage: "create", progress: 82, artistsDone: 13, artistsTotal: 13 },
      "Creating…",
    ],
    [
      { status: "running", stage: "write", progress: 92, artistsDone: 13, artistsTotal: 13 },
      "Adding songs…",
    ],
  ])("%j", (p, label) => {
    expect(stageLabel(p)).toBe(label);
  });
});

describe("never an endless wait", () => {
  it("stops after several steps with no progress and says so in two words", () => {
    let view: PlaylistView = building;
    for (let i = 0; i <= MAX_STALLED_STEPS; i++)
      view = viewFromStep(step({ status: "queued", stage: null, progress: 0 }), view);
    expect(view).toMatchObject({
      kind: "problem",
      message: expect.stringMatching(/still cooking/i),
    });
  });

  it("a Spotify pause is a known wait, not a stall", () => {
    let view: PlaylistView = building;
    for (let i = 0; i < MAX_STALLED_STEPS + 2; i++) {
      view = viewFromStep(step({ status: "paused", resumeAfter: "2026-11-21T13:10:00Z" }), view);
    }
    expect(view.kind).toBe("building");
  });

  it("a 503 while stepping means playlist making isn't open yet", () => {
    expect(viewFromStep({ error: { code: "playlist_unavailable" } }, building, 503)).toEqual({
      kind: "unavailable",
    });
  });
});

describe("a paused build shows as paused at once (no 'Joining…')", () => {
  const paused = {
    jobId: "job-1",
    status: "paused",
    stage: "select",
    progress: 17,
    artistsDone: 6,
    artistsTotal: 34,
    unresolved: [],
    resumeAfter: "2026-11-22T12:03:40.151Z",
  };

  it("from a server-rendered status that carries the job's progress", () => {
    const view = viewFromStatus({ status: "building", jobId: "job-1", progress: paused });
    expect(view).toMatchObject({
      kind: "building",
      joined: true,
      waitUntil: "2026-11-22T12:03:40.151Z",
      progress: 17,
    });
    expect(formatClock("2026-11-22T12:03:40.151Z")).toBe("5:33 pm");
  });

  it("without progress it asks the job straight away instead of waiting 1.5 s", () => {
    const view = viewFromStatus({ status: "building", jobId: "job-1" });
    expect(view).toMatchObject({ kind: "building", label: "Joining…" });
    expect(nextStepDelay(activeJob(view)!, new Date())).toBe(0);
  });

  it("a finished job in the status goes straight to ready", () => {
    const view = viewFromStatus({
      status: "building",
      jobId: "job-1",
      progress: { ...paused, status: "succeeded", stage: "done", progress: 100, playlistUrl: URL_ },
    });
    expect(view).toMatchObject({ kind: "ready", url: URL_ });
  });
});

describe("no tight loops, no downgrades", () => {
  const paused = viewFromStatus({
    status: "building",
    jobId: "job-1",
    progress: {
      jobId: "job-1",
      status: "paused",
      stage: "select",
      progress: 17,
      artistsDone: 6,
      artistsTotal: 34,
      unresolved: [],
      resumeAfter: "2026-11-22T12:03:40.151Z",
    },
  });
  const joining = viewFromStatus({ status: "building", jobId: "job-1" });

  it("a refresh without progress keeps the known pause for the same job", () => {
    expect(refreshView(paused, joining)).toBe(paused);
    expect(
      refreshView(paused, viewFromStatus({ status: "building", jobId: "job-2" })),
    ).toMatchObject({ jobId: "job-2" });
    expect(refreshView(joining, viewFromStatus({ status: "none" }))).toEqual({ kind: "idle" });
  });

  it("a failed first step backs off to the normal 1.5 s", () => {
    const after = afterFailedStep(joining);
    expect(nextStepDelay(activeJob(after)!, new Date())).toBe(1500);
  });
});

describe("QA-F-19: a short Spotify pause on a 'running' job still reads as paused", () => {
  const now = new Date("2026-11-21T13:09:40Z");
  it("a running job with a resume time ahead shows the pause", () => {
    const view = viewFromStep(
      step({ status: "running", resumeAfter: "2026-11-21T13:10:00Z" }),
      building,
      200,
      now,
    );
    expect(view).toMatchObject({ kind: "building", waitUntil: "2026-11-21T13:10:00Z" });
  });
  it("a resume time already past on a running job is just progress", () => {
    const view = viewFromStep(
      step({ status: "running", resumeAfter: "2026-11-21T13:09:00Z" }),
      building,
      200,
      now,
    );
    expect(view).toMatchObject({ kind: "building", waitUntil: null });
  });
});

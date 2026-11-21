import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PlaylistsServer from "@/server/playlists";
import { playlistWorld } from "@/application/playlists/testing/fakes";

const wired = vi.hoisted(() => ({ current: null as unknown }));
// D-070's clientKey reads the platform env; here the caller's IP comes straight from x-real-ip.
vi.mock("@/server/client-key", () => ({
  LOCAL_CLIENT_KEY: "local",
  clientKey: (req: Request) => req.headers.get("x-real-ip") ?? "local",
}));
vi.mock("@/server/playlists", async (importOriginal) => ({
  ...(await importOriginal<typeof PlaylistsServer>()),
  playlists: () => wired.current,
}));

const eventRoute = await import("../events/[id]/playlist/route");
const jobRoute = await import("./[id]/route");
const estimateRoute = await import("../events/[id]/playlist/estimate/route");
const stepRoute = await import("./[id]/step/route");

let w: ReturnType<typeof playlistWorld>;
let eventId: string;

beforeEach(() => {
  w = playlistWorld({ startsPerHour: 2 });
  wired.current = w.useCases;
  const ritviz = w.spotify.addArtist("Ritviz");
  eventId = w.events.add([
    { name: "Ritviz", tier: "headliner", spotifyId: ritviz.id },
    { name: "Unknown", tier: "support", spotifyId: null },
  ]).id;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: string, ip = "1.2.3.4") =>
  new Request("http://x", {
    method: "POST",
    body,
    headers: { "x-real-ip": ip },
  });

describe("POST /api/events/:id/playlist", () => {
  it("starts a build (202), steps it to the end, then answers ready (200)", async () => {
    const started = await eventRoute.POST(post(), ctx(eventId));
    expect(started.status).toBe(202);
    const { status, jobId } = await started.json();
    expect(status).toBe("building");

    const polled = await jobRoute.GET(new Request("http://x"), ctx(jobId));
    expect(await polled.json()).toMatchObject({ jobId, status: "queued", progress: 0 });

    let body: Record<string, unknown> = {};
    for (let i = 0; i < 20 && body.status !== "partial"; i++) {
      const res = await stepRoute.POST(post("{}"), ctx(jobId));
      expect(res.status).toBe(200);
      body = await res.json();
    }
    expect(body).toMatchObject({
      status: "partial",
      progress: 100,
      unresolved: ["Unknown"],
      playlistUrl: "https://open.spotify.com/playlist/pl1",
    });

    const again = await eventRoute.POST(post(), ctx(eventId));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      status: "ready",
      url: "https://open.spotify.com/playlist/pl1",
    });

    const read = await eventRoute.GET(new Request("http://x"), ctx(eventId));
    expect(await read.json()).toMatchObject({
      status: "ready",
      url: "https://open.spotify.com/playlist/pl1",
      stale: false,
      builtAt: expect.any(String),
    });
  });

  it("joins the running build for a second visitor", async () => {
    const a = await (await eventRoute.POST(post(), ctx(eventId))).json();
    const b = await (await eventRoute.POST(post(undefined, "5.5.5.5"), ctx(eventId))).json();
    expect(b).toEqual(a);
    const read = await eventRoute.GET(new Request("http://x"), ctx(eventId));
    expect(await read.json()).toEqual({ status: "building", jobId: a.jobId });
  });

  it.each([
    ["unknown keys", '{"force":true}'],
    ["a non-object", "[1]"],
    ["invalid JSON", "{"],
  ])("400s a body with %s (D-018)", async (_n, body) => {
    const res = await eventRoute.POST(post(body), ctx(eventId));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
  });

  it.each(["nope", "00000000-0000-4000-8000-ffffffffffff"])("404s event %s", async (id) => {
    expect((await eventRoute.POST(post(), ctx(id))).status).toBe(404);
    expect((await eventRoute.GET(new Request("http://x"), ctx(id))).status).toBe(404);
  });

  it("429s with Retry-After when one IP starts too many builds", async () => {
    const other = w.events.add([
      { name: "Ritviz", tier: "headliner", spotifyId: w.spotify.artists[0]!.id },
    ]).id;
    const third = w.events.add([
      { name: "Ritviz", tier: "headliner", spotifyId: w.spotify.artists[0]!.id },
    ]).id;
    expect((await eventRoute.POST(post(), ctx(eventId))).status).toBe(202);
    expect((await eventRoute.POST(post(), ctx(other))).status).toBe(202);
    const limited = await eventRoute.POST(post(), ctx(third));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect((await limited.json()).error.code).toBe("rate_limited");
  });

  it("503s when the publisher is not connected", async () => {
    w.publisher.row = null;
    const res = await eventRoute.POST(post(), ctx(eventId));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({ code: "playlist_unavailable" });
  });

  it("422s when no artist is matched", async () => {
    const id = w.events.add([{ name: "Nobody", tier: "headliner", spotifyId: null }]).id;
    const res = await eventRoute.POST(post(), ctx(id));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("no_matched_artists");
  });

  it("reports none before any build", async () => {
    const res = await eventRoute.GET(new Request("http://x"), ctx(eventId));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "none" });
  });
});

describe("/api/playlist-jobs/:id", () => {
  it.each(["nope", "00000000-0000-4000-8000-ffffffffffff"])("404s job %s", async (id) => {
    expect((await jobRoute.GET(new Request("http://x"), ctx(id))).status).toBe(404);
    expect((await stepRoute.POST(post(), ctx(id))).status).toBe(404);
  });

  it("400s a step body with unknown keys", async () => {
    const { jobId } = await (await eventRoute.POST(post(), ctx(eventId))).json();
    expect((await stepRoute.POST(post('{"x":1}'), ctx(jobId))).status).toBe(400);
  });
});

describe("GET /api/events/:id/playlist/estimate (D-065)", () => {
  it("previews songs and minutes per tier from the build's plan", async () => {
    const res = await estimateRoute.GET(new Request("http://x"), ctx(eventId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // One matched headliner on a default 8 h festival day gets the whole day.
    expect(await res.json()).toEqual({
      songs: 128,
      minutes: 480,
      showMinutes: 480,
      days: 1,
      unmatched: 1,
      // 128 songs need the maximum 6 search pages: about 13 s when nothing is cached.
      readiness: { cachedArtists: 0, artists: 1, seconds: 13 },
      perTier: [{ tier: "headliner", artists: 1, songs: 128, minutes: 480 }],
    });
  });

  it.each(["nope", "00000000-0000-4000-8000-ffffffffffff"])("404s %s", async (id) => {
    expect((await estimateRoute.GET(new Request("http://x"), ctx(id))).status).toBe(404);
  });
});

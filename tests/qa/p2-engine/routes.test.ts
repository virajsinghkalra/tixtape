/**
 * QA P2.5: playlist HTTP routes and the admin publisher routes (D-018, D-036, D-043).
 * The module behind `playlists()` is the real use-case layer on QA fakes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistsUseCases } from "@/application/playlists";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import {
  EVENT,
  SECRET_ACCESS,
  SECRET_REFRESH,
  makeEvent,
  makeWorld,
  seedArtists,
  type World,
} from "./fakes";
import { FixedWindowLimiter } from "@/application/playlists/start-limiter";

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "user" | "anon",
  module: null as unknown,
}));

vi.mock("@/server/auth/guards", () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(async () => {
    if (state.role === "anon") throw new UnauthorizedError("Sign in.");
    if (state.role === "user") throw new ForbiddenError("Admins only.");
    return {
      id: "44444444-4444-4444-8444-444444444444",
      spotifyUserId: "adm",
      displayName: "Admin",
      market: "IN",
      role: "admin",
    };
  }),
}));
vi.mock("@/server/playlists", async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...real, playlists: () => state.module as PlaylistsUseCases };
});

const eventRoute = await import("@/app/api/events/[id]/playlist/route");
const stepRoute = await import("@/app/api/playlist-jobs/[id]/step/route");
const jobRoute = await import("@/app/api/playlist-jobs/[id]/route");
const adminRoute = await import("@/app/api/admin/publisher/route");

const GHOST = "11111111-1111-4111-8111-111111111111";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method: string, body?: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      "x-forwarded-for": "9.9.9.9",
      ...headers,
    },
    body,
  });
const postPlaylist = (id: string, body?: string, headers?: Record<string, string>) =>
  eventRoute.POST(req(`/api/events/${id}/playlist`, "POST", body, headers), ctx(id));
const getPlaylist = (id: string) =>
  eventRoute.GET(req(`/api/events/${id}/playlist`, "GET"), ctx(id));
const step = (id: string, body?: string) =>
  stepRoute.POST(req(`/api/playlist-jobs/${id}/step`, "POST", body), ctx(id));
const getJob = (id: string) => jobRoute.GET(req(`/api/playlist-jobs/${id}`, "GET"), ctx(id));
const adminGet = () => adminRoute.GET(req("/api/admin/publisher", "GET"), undefined as never);
const adminPost = (body?: string) =>
  adminRoute.POST(req("/api/admin/publisher", "POST", body), undefined as never);

let w: World;
const all: string[] = [];
async function read(res: Response) {
  const text = await res.text();
  all.push(text, JSON.stringify([...res.headers]));
  return text ? JSON.parse(text) : null;
}

beforeEach(() => {
  state.role = "admin";
  w = makeWorld();
  state.module = w.uc;
  w.events.put(makeEvent(EVENT, seedArtists(w, 2, "headliner", 10)));
});

describe("QA POST /api/events/:id/playlist", () => {
  it.each([undefined, "", "{}"])("body %j → 202 building with jobId", async (body) => {
    const res = await postPlaylist(EVENT, body);
    expect(res.status).toBe(202);
    const j = await read(res);
    expect(j).toMatchObject({ status: "building" });
    expect(j.jobId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it.each([
    '{"x":1}',
    '{"tracksPerTier":{"headliner":99}}',
    '{"__proto__":{"admin":true}}',
    "[]",
    "null",
    "{",
    '"str"',
  ])("body %s → 400", async (body) => {
    const res = await postPlaylist(EVENT, body);
    expect(res.status).toBe(400);
    expect(w.jobs.jobs.size).toBe(0);
  });

  it("returns 200 ready with the url once built", async () => {
    const j = await read(await postPlaylist(EVENT));
    for (let i = 0; i < 50; i += 1) {
      const p = await read(await step(j.jobId));
      if (["succeeded", "partial", "failed"].includes(p.status)) break;
      w.clock.advance(1_500);
    }
    const res = await postPlaylist(EVENT);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      status: "ready",
      url: expect.stringMatching(/^https:\/\/open\.spotify\.com\/playlist\//u),
    });
  });

  it.each([GHOST, "not-a-uuid", "../../admin"])("unknown event %s → 404", async (id) => {
    expect((await postPlaylist(id)).status).toBe(404);
  });

  it("no matched artists → 422 no_matched_artists", async () => {
    w.events.put(makeEvent(EVENT, [{ name: "X", tier: "headliner", rank: 1, spotifyId: null }]));
    const res = await postPlaylist(EVENT);
    expect(res.status).toBe(422);
    expect((await read(res)).error.code).toBe("no_matched_artists");
  });

  it.each(["none", "missing", "reauth"] as const)(
    "publisher %s → 503 playlist_unavailable",
    async (kind) => {
      if (kind === "none") w.pub.record = null;
      else w.pub.token = kind;
      const res = await postPlaylist(EVENT);
      expect(res.status).toBe(503);
      const body = await read(res);
      expect(body.error.code).toBe("playlist_unavailable");
      expect(JSON.stringify(body)).not.toMatch(/reauth|token|invalid_grant/iu);
    },
  );

  function limitedWorld(): string[] {
    w = makeWorld({ limiter: new FixedWindowLimiter(10, 3600_000, { now: () => w.clock.now() }) });
    state.module = w.uc;
    const ids = Array.from(
      { length: 12 },
      (_, i) => `${"5".repeat(8)}-5555-4555-8555-${String(i).padStart(12, "0")}`,
    );
    for (const id of ids)
      w.events.put(
        makeEvent(id as never, seedArtists(w, 1, "headliner", 10, 1, `e${id.slice(-2)}`)),
      );
    return ids;
  }

  // D-070: on Vercel the client key comes from x-real-ip (set by the platform), never raw XFF.
  it("11th start in an hour from one IP → 429 rate_limited with Retry-After", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const ids = limitedWorld();
      const ip = (v: string) => ({ "x-real-ip": v });
      for (const id of ids.slice(0, 10))
        expect((await postPlaylist(id, undefined, ip("9.9.9.9"))).status).toBe(202);
      const res = await postPlaylist(ids[10]!, undefined, ip("9.9.9.9"));
      expect(res.status).toBe(429);
      expect((await read(res)).error.code).toBe("rate_limited");
      const ra = Number(res.headers.get("retry-after"));
      expect(Number.isInteger(ra)).toBe(true);
      expect(ra).toBeGreaterThan(0);
      expect(ra).toBeLessThanOrEqual(3600);
      // A spoofed x-forwarded-for doesn't change the key.
      expect(
        (
          await postPlaylist(ids[10]!, undefined, {
            ...ip("9.9.9.9"),
            "x-forwarded-for": "8.8.8.8",
          })
        ).status,
      ).toBe(429);
      // A different platform-reported IP is a separate bucket.
      expect((await postPlaylist(ids[10]!, undefined, ip("8.8.8.8"))).status).toBe(202);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // D-070: off Vercel every caller shares one key, so rotating x-forwarded-for can't dodge the limit.
  it("off Vercel, x-forwarded-for is ignored: all callers share one start limit", async () => {
    vi.stubEnv("VERCEL", "");
    try {
      const ids = limitedWorld();
      for (const [i, id] of ids.slice(0, 10).entries())
        expect(
          (await postPlaylist(id, undefined, { "x-forwarded-for": `10.0.0.${i}` })).status,
        ).toBe(202);
      expect(
        (await postPlaylist(ids[10]!, undefined, { "x-forwarded-for": "8.8.8.8" })).status,
      ).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("QA GET /api/events/:id/playlist", () => {
  it("none → building (no url yet) → ready (not stale) → stale after a lineup change", async () => {
    expect(await read(await getPlaylist(EVENT))).toEqual({ status: "none" });
    const { jobId } = await read(await postPlaylist(EVENT));
    const b = await read(await getPlaylist(EVENT));
    expect(b).toMatchObject({ status: "building", jobId });
    for (let i = 0; i < 50; i += 1) {
      const p = await read(await step(jobId));
      if (["succeeded", "partial"].includes(p.status)) break;
      w.clock.advance(1_500);
    }
    const r = await read(await getPlaylist(EVENT));
    expect(r).toMatchObject({ status: "ready", stale: false, url: expect.any(String) });
    expect(Number.isNaN(Date.parse(r.builtAt))).toBe(false);
    w.events.put(makeEvent(EVENT, seedArtists(w, 3, "headliner", 10, 1, "chg"), "hash-2"));
    expect(await read(await getPlaylist(EVENT))).toMatchObject({ status: "ready", stale: true });
  });

  it("GET never starts a build", async () => {
    await getPlaylist(EVENT);
    expect(w.jobs.jobs.size).toBe(0);
  });

  it("unknown event → 404", async () => {
    expect((await getPlaylist(GHOST)).status).toBe(404);
  });
});

describe("QA job routes", () => {
  const KEYS = [
    "jobId",
    "status",
    "stage",
    "progress",
    "artistsDone",
    "artistsTotal",
    "unresolved",
  ];

  it("step returns the full progress shape", async () => {
    const { jobId } = await read(await postPlaylist(EVENT));
    const res = await step(jobId);
    expect(res.status).toBe(200);
    const p = await read(res);
    for (const k of KEYS) expect(p).toHaveProperty(k);
    expect(Array.isArray(p.unresolved)).toBe(true);
    expect(p.progress).toBeGreaterThanOrEqual(0);
    expect(p.progress).toBeLessThanOrEqual(100);
  });

  it("GET job has the same shape and does no work", async () => {
    const { jobId } = await read(await postPlaylist(EVENT));
    const res = await getJob(jobId);
    expect(res.status).toBe(200);
    const p = await read(res);
    for (const k of KEYS) expect(p).toHaveProperty(k);
    expect(w.tracks.searches).toHaveLength(0);
    expect(w.writer.calls).toHaveLength(0);
  });

  it.each([GHOST, "nope", "1", "11111111-1111-4111-8111-11111111111", "%00"])(
    "bad job id %s → 404 (not 500)",
    async (id) => {
      expect((await step(id)).status).toBe(404);
      expect((await getJob(id)).status).toBe(404);
    },
  );

  it("step with extra body keys → 400 and no work", async () => {
    const { jobId } = await read(await postPlaylist(EVENT));
    expect((await step(jobId, '{"force":true}')).status).toBe(400);
    expect(w.tracks.searches).toHaveLength(0);
  });

  it("step with {} or empty body is fine", async () => {
    const { jobId } = await read(await postPlaylist(EVENT));
    expect((await step(jobId, "{}")).status).toBe(200);
    w.clock.advance(1_500);
    expect((await step(jobId)).status).toBe(200);
  });
});

describe("QA /api/admin/publisher", () => {
  it.each([
    ["anon", 401],
    ["user", 403],
  ] as const)("%s → %i on GET and POST", async (role, code) => {
    state.role = role;
    expect((await adminGet()).status).toBe(code);
    expect((await adminPost()).status).toBe(code);
    expect(w.pub.record?.userId).not.toBe("44444444-4444-4444-8444-444444444444");
  });

  it("GET reports status without tokens", async () => {
    const res = await adminGet();
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ connected: true, needsReauth: false });
  });

  it("GET shows needsReauth", async () => {
    w.pub.token = "reauth";
    expect(await read(await adminGet())).toMatchObject({ connected: true, needsReauth: true });
  });

  it("POST sets the current admin as publisher", async () => {
    const res = await adminPost();
    expect(res.status).toBe(200);
    expect(w.pub.record?.userId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it.each(["missing", "reauth"] as const)(
    "POST with tokens %s → 409, publisher unchanged",
    async (kind) => {
      w.pub.token = kind;
      const before = w.pub.record;
      const res = await adminPost();
      expect(res.status).toBe(409);
      expect(w.pub.record).toEqual(before);
    },
  );

  it("POST with extra keys → 400", async () => {
    expect((await adminPost('{"userId":"someone-else"}')).status).toBe(400);
  });
});

describe("QA security", () => {
  it("no response body or header ever contained a token", () => {
    const joined = all.join("\n");
    expect(joined.length).toBeGreaterThan(0);
    expect(joined).not.toContain(SECRET_ACCESS);
    expect(joined).not.toContain(SECRET_REFRESH);
  });
});

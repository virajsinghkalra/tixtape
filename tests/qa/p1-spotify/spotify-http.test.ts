import { http as mock, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { isAppError, UpstreamError } from "@/lib/errors";
import { API, T0, dump, httpRig, type HttpRig } from "./fakes";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const okSchema = z.object({ ok: z.boolean() });
const call = (rig: HttpRig, path = "/qa") =>
  rig.time.run(rig.http.request({ method: "GET", path, auth: { kind: "app" }, schema: okSchema }));

type Reply = () => Response | Promise<Response>;
/** Serves the replies in order (the last one repeats) and records each request. */
function script(replies: Reply[], path = "/qa") {
  const seen: { at: number; auth: string | null }[] = [];
  let i = 0;
  return {
    seen,
    install(rig: HttpRig) {
      server.use(
        mock.all(`${API}${path}`, ({ request }) => {
          seen.push({ at: rig.time.clock.t, auth: request.headers.get("authorization") });
          const r = replies[Math.min(i++, replies.length - 1)]!;
          return r();
        }),
      );
    },
  };
}
const ok: Reply = () => HttpResponse.json({ ok: true });
const r429 =
  (retryAfter?: string, body: unknown = { error: { status: 429, message: "rate" } }): Reply =>
  () =>
    HttpResponse.json(body as never, {
      status: 429,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    });
const quota = (retryAfter?: string): Reply =>
  r429(retryAfter, { error: { status: 429, message: "quota", reason: "QUOTA_EXCEEDED" } });

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}

describe("QA SpotifyHttp: shared gate (D-006, D-020)", () => {
  it("makes no request while paused_until is in the future; throws gate_paused", async () => {
    const rig = httpRig();
    const s = script([ok]);
    s.install(rig);
    rig.gate.pausedUntil = new Date(T0 + 30_000);
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect((e as SpotifyBlockedError).reason).toBe("gate_paused");
    expect((e as SpotifyBlockedError).resumeAfter.getTime()).toBeGreaterThanOrEqual(T0 + 30_000);
    expect(s.seen).toHaveLength(0);
  });

  it("proceeds when paused_until is in the past", async () => {
    const rig = httpRig();
    const s = script([ok]);
    s.install(rig);
    rig.gate.pausedUntil = new Date(T0 - 1);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(1);
  });

  it("a pause set by another process right after our last read still blocks the next call", async () => {
    // BUG: gate reads are cached (gateCacheMs) so a pause set by another worker is ignored for up to 2s; D-006 says no calls while a pause is in effect.
    const rig = httpRig();
    const s = script([ok]);
    s.install(rig);
    await call(rig);
    rig.gate.pausedUntil = new Date(rig.time.clock.t + 3_600_000);
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect(s.seen).toHaveLength(1);
  });

  it("after this process hits a long 429, its very next call is blocked locally", async () => {
    const rig = httpRig();
    const s = script([r429("3600"), ok]);
    s.install(rig);
    await caught(call(rig));
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect((e as SpotifyBlockedError).reason).toBe("gate_paused");
    expect(s.seen).toHaveLength(1);
  });
});

describe("QA SpotifyHttp: 429 handling (D-006, D-020)", () => {
  it("Retry-After > 120s: one call, pauses the gate, throws long_retry_after, no retry", async () => {
    const rig = httpRig();
    const s = script([r429("121"), ok]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect(e.reason).toBe("long_retry_after");
    expect(s.seen).toHaveLength(1);
    expect(e.resumeAfter.getTime()).toBeGreaterThanOrEqual(T0 + 121_000);
    expect(rig.gate.pausedUntil!.getTime()).toBeGreaterThanOrEqual(T0 + 121_000);
    expect(rig.time.sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(121_000);
  });

  it("Retry-After = 120s exactly is waited out, then retried", async () => {
    // BUG: Retry-After: 120 throws SpotifyBlockedError(gate_paused) without retrying; D-006 only pauses the job for > 120s (119 is retried).
    const rig = httpRig();
    const s = script([r429("120"), ok]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[1]!.at - s.seen[0]!.at).toBeGreaterThanOrEqual(120_000);
  });

  it("Retry-After as an HTTP-date hours ahead blocks with that date", async () => {
    const rig = httpRig();
    const until = new Date(T0 + 3 * 3_600_000);
    const s = script([r429(until.toUTCString())]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect(e.reason).toBe("long_retry_after");
    expect(Math.abs(e.resumeAfter.getTime() - until.getTime())).toBeLessThan(2_000);
    expect(s.seen).toHaveLength(1);
  });

  it("Retry-After as a short HTTP-date is waited out", async () => {
    const rig = httpRig();
    const s = script([r429(new Date(T0 + 5_000).toUTCString()), ok]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen[1]!.at - s.seen[0]!.at).toBeGreaterThanOrEqual(4_000);
  });

  it("QUOTA_EXCEEDED with a short Retry-After still blocks (no retry)", async () => {
    const rig = httpRig();
    const s = script([quota("5"), ok]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect(e.reason).toBe("quota_exceeded");
    expect(s.seen).toHaveLength(1);
    expect(rig.gate.pausedUntil!.getTime()).toBeGreaterThanOrEqual(T0 + 5_000);
  });

  it("QUOTA_EXCEEDED without Retry-After pauses for 1 hour", async () => {
    const rig = httpRig();
    const s = script([quota()]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e.reason).toBe("quota_exceeded");
    expect(e.resumeAfter.getTime()).toBeGreaterThanOrEqual(T0 + 3_600_000);
    expect(e.resumeAfter.getTime()).toBeLessThan(T0 + 3_600_000 + 60_000);
    expect(rig.gate.pausedUntil!.getTime()).toBeGreaterThanOrEqual(T0 + 3_600_000);
    expect(s.seen).toHaveLength(1);
  });

  it("QUOTA_EXCEEDED with garbage Retry-After still pauses ≥ 1 hour", async () => {
    const rig = httpRig();
    const s = script([quota("soon")]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e.reason).toBe("quota_exceeded");
    expect(e.resumeAfter.getTime()).toBeGreaterThanOrEqual(T0 + 3_600_000);
  });

  it("a 429 whose body is not JSON does not crash; treated as a plain 429", async () => {
    const rig = httpRig();
    const s = script([
      () =>
        new HttpResponse("<html>Too many</html>", { status: 429, headers: { "Retry-After": "1" } }),
      ok,
    ]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(2);
  });

  it("short 429 also extends the shared gate so other workers wait (LLD §8.2 setMaxPausedUntil)", async () => {
    const rig = httpRig();
    const s = script([r429("10"), ok]);
    s.install(rig);
    await call(rig);
    expect(rig.gate.extensions.length).toBeGreaterThan(0);
    expect(rig.gate.pausedUntil!.getTime()).toBeGreaterThanOrEqual(T0 + 10_000);
  });

  it.each(["abc", "-5", "", "NaN"])(
    "garbage/negative Retry-After %j falls back to bounded jitter and retries",
    async (h) => {
      const rig = httpRig();
      const s = script([r429(h), ok]);
      s.install(rig);
      await expect(call(rig)).resolves.toEqual({ ok: true });
      expect(s.seen).toHaveLength(2);
      for (const ms of rig.time.sleeps) {
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThanOrEqual(0);
        expect(ms).toBeLessThanOrEqual(61_000);
      }
    },
  );

  it("missing Retry-After falls back to jitter and retries", async () => {
    const rig = httpRig();
    const s = script([r429(), ok]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(2);
  });

  it("huge Retry-After (years) blocks with a valid resumeAfter date, no retry", async () => {
    const rig = httpRig();
    const s = script([r429("99999999"), ok]);
    s.install(rig);
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    const b = e as SpotifyBlockedError;
    expect(b.reason).toBe("long_retry_after");
    expect(Number.isNaN(b.resumeAfter.getTime())).toBe(false);
    expect(s.seen).toHaveLength(1);
  });

  it("absurd Retry-After (400 digits) never yields an Invalid Date pause", async () => {
    const rig = httpRig();
    const s = script([r429("9".repeat(400)), ok]);
    s.install(rig);
    try {
      await call(rig);
    } catch (e) {
      expect(e).toBeInstanceOf(SpotifyBlockedError);
      expect(Number.isNaN((e as SpotifyBlockedError).resumeAfter.getTime())).toBe(false);
    }
    for (const d of rig.gate.extensions) expect(Number.isNaN(d.getTime())).toBe(false);
    expect(s.seen.length).toBeLessThanOrEqual(2);
  });

  it("after 5 attempts that all got 429, throws gate_paused and stops (≤5 attempts)", async () => {
    const rig = httpRig();
    const s = script([r429("1")]);
    s.install(rig);
    const e = (await caught(call(rig))) as SpotifyBlockedError;
    expect(e).toBeInstanceOf(SpotifyBlockedError);
    expect(e.reason).toBe("gate_paused");
    expect(s.seen).toHaveLength(5);
  });

  it("never calls Spotify before Retry-After has elapsed", async () => {
    const rig = httpRig();
    const s = script([r429("7"), r429("9"), ok]);
    s.install(rig);
    await call(rig);
    expect(s.seen[1]!.at - s.seen[0]!.at).toBeGreaterThanOrEqual(7_000);
    expect(s.seen[2]!.at - s.seen[1]!.at).toBeGreaterThanOrEqual(9_000);
  });
});

describe("QA SpotifyHttp: 5xx / network (D-006)", () => {
  it("5xx then success retries with jitter", async () => {
    const rig = httpRig();
    const s = script([() => new HttpResponse(null, { status: 503 }), ok]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(2);
  });

  it("persistent 500 gives up after 5 attempts with UpstreamError; each wait ≤ 60s", async () => {
    const rig = httpRig({}, 0.999999);
    const s = script([() => new HttpResponse("boom", { status: 500 })]);
    s.install(rig);
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(s.seen).toHaveLength(5);
    for (const ms of rig.time.sleeps) expect(ms).toBeLessThanOrEqual(60_500 + 500);
  });

  it("network errors are retried then surface as UpstreamError", async () => {
    const rig = httpRig();
    const s = script([() => HttpResponse.error()]);
    s.install(rig);
    const e = await caught(call(rig));
    expect(e).toBeInstanceOf(UpstreamError);
    expect(s.seen).toHaveLength(5);
  });

  it("4xx (non-401/429) is not retried", async () => {
    const rig = httpRig();
    const s = script([() => HttpResponse.json({ error: { status: 400 } }, { status: 400 })]);
    s.install(rig);
    const e = await caught(call(rig));
    expect(isAppError(e)).toBe(true);
    expect(s.seen).toHaveLength(1);
  });

  it("maxAttempts config is respected (hard ≤ 5 by default)", async () => {
    const rig = httpRig({ maxAttempts: 2 });
    const s = script([() => new HttpResponse(null, { status: 502 })]);
    s.install(rig);
    await caught(call(rig));
    expect(s.seen).toHaveLength(2);
  });
});

describe("QA SpotifyHttp: 401 → one refresh (D-020)", () => {
  it("refreshes once with the rejected token, retries with the new one", async () => {
    const rig = httpRig();
    const s = script([() => new HttpResponse(null, { status: 401 }), ok]);
    s.install(rig);
    await expect(call(rig)).resolves.toEqual({ ok: true });
    expect(s.seen).toHaveLength(2);
    expect(s.seen[0]!.auth).toBe("Bearer qa-access-token-1");
    expect(s.seen[1]!.auth).toBe("Bearer qa-access-token-2");
    expect(rig.tokens.calls[1]!.rejected).toBe("qa-access-token-1");
  });

  it("a second 401 gives up (no refresh loop)", async () => {
    const rig = httpRig();
    const s = script([() => new HttpResponse(null, { status: 401 })]);
    s.install(rig);
    const e = await caught(call(rig));
    expect(isAppError(e)).toBe(true);
    expect(s.seen).toHaveLength(2);
    expect(rig.tokens.calls).toHaveLength(2);
  });

  it("token auth (sign-in callback) is never 'refreshed'", async () => {
    const rig = httpRig();
    const s = script([() => new HttpResponse(null, { status: 401 })]);
    s.install(rig);
    const e = await caught(
      rig.time.run(
        rig.http.request({
          method: "GET",
          path: "/qa",
          auth: { kind: "token", accessToken: "raw-tok" },
          schema: okSchema,
        }),
      ),
    );
    expect(isAppError(e)).toBe(true);
    expect(rig.tokens.calls).toHaveLength(0);
  });
});

describe("QA SpotifyHttp: malformed responses", () => {
  it.each([
    [
      "not JSON",
      () =>
        new HttpResponse("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ],
    ["wrong shape", () => HttpResponse.json({ ok: "yes" })],
    ["null body", () => HttpResponse.json(null)],
    ["empty body", () => new HttpResponse("", { status: 200 })],
  ])("%s → a clean AppError (UpstreamError), not a raw Zod/Syntax error", async (_n, r) => {
    const rig = httpRig();
    script([r]).install(rig);
    const e = await caught(call(rig));
    expect(isAppError(e)).toBe(true);
    expect(e).toBeInstanceOf(UpstreamError);
  });
});

describe("QA SpotifyHttp: tokens never logged or leaked in errors", () => {
  it.each([
    ["401", () => new HttpResponse(null, { status: 401 })],
    ["500", () => new HttpResponse("err", { status: 500 })],
    ["429", r429("1")],
    ["bad json", () => HttpResponse.json({ ok: 1 })],
  ])("%s", async (_n, r) => {
    const rig = httpRig();
    script([r]).install(rig);
    const e = await caught(call(rig));
    const out = dump(rig.warnings) + dump(e) + String((e as Error).message);
    expect(out).not.toMatch(/qa-access-token/);
  });
});

describe("QA SpotifyHttp: concurrency + pacing (LLD §8.2: in-flight cap 3, ~3 req/s)", () => {
  it("never has more than 3 requests in flight", async () => {
    const rig = httpRig();
    let inFlight = 0;
    let max = 0;
    const releases: (() => void)[] = [];
    server.use(
      mock.get(`${API}/qa`, async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise<void>((r) => releases.push(r));
        inFlight--;
        return HttpResponse.json({ ok: true });
      }),
    );
    const all = Promise.all(
      Array.from({ length: 10 }, () =>
        rig.http.request({ method: "GET", path: "/qa", auth: { kind: "app" }, schema: okSchema }),
      ),
    );
    // Release held responses as they arrive while driving virtual time.
    const pump = setInterval(() => releases.splice(0).forEach((r) => setImmediate(r)), 1);
    try {
      await rig.time.run(all);
    } finally {
      clearInterval(pump);
    }
    expect(max).toBeLessThanOrEqual(3);
    expect(max).toBeGreaterThan(0);
  });

  it("paces to ~3 req/s: 12 requests take at least ~3s of (virtual) time", async () => {
    const rig = httpRig();
    const s = script([ok]);
    s.install(rig);
    await rig.time.run(
      Promise.all(
        Array.from({ length: 12 }, () =>
          rig.http.request({ method: "GET", path: "/qa", auth: { kind: "app" }, schema: okSchema }),
        ),
      ),
    );
    expect(s.seen).toHaveLength(12);
    const span = s.seen[11]!.at - s.seen[0]!.at;
    expect(span).toBeGreaterThanOrEqual(2_900);
    // Token bucket: a burst of ≤3, then ≤3/s, so any 1s window holds at most 3 + 3 starts.
    for (const a of s.seen) {
      const inWindow = s.seen.filter((b) => b.at >= a.at && b.at < a.at + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(6);
    }
    // Steady state: after the burst, starts are ≥ ~1/3s apart.
    for (let i = 4; i < s.seen.length; i++) {
      expect(s.seen[i]!.at - s.seen[i - 1]!.at).toBeGreaterThanOrEqual(300);
    }
  });
});

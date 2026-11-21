import { http as mock, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { UpstreamError } from "@/lib/errors";
import { SpotifyHttp, type SpotifyAuth } from "./spotify-http";
import {
  FakeClock,
  fakeSleep,
  fixedRandom,
  MemoryGateStore,
  StaticTokens,
  T0,
} from "./test-support";

const PING = "https://api.spotify.com/v1/ping";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const clock = new FakeClock();
  const { sleep, calls: sleeps } = fakeSleep(clock);
  const gate = new MemoryGateStore();
  const tokens = new StaticTokens();
  const logs: unknown[] = [];
  const client = new SpotifyHttp({
    fetch: (input, init) => fetch(input, init),
    clock,
    random: fixedRandom(0.5),
    sleep,
    gate,
    tokens,
    logger: { warn: (obj, msg) => logs.push({ obj, msg }) },
  });
  const ping = (auth: SpotifyAuth = { kind: "app" }) =>
    client.request({
      method: "GET",
      path: "/ping",
      query: { q: "a b", skip: undefined },
      auth,
      schema: z.object({ ok: z.boolean() }),
    });
  return { clock, sleeps, gate, tokens, logs, ping };
}

/** Serves the responses in order (the last one repeats) and records each request. */
function serve(...responses: Array<() => Response>) {
  const requests: Request[] = [];
  server.use(
    mock.get(PING, ({ request }) => {
      requests.push(request);
      return (responses[Math.min(requests.length, responses.length) - 1] as () => Response)();
    }),
  );
  return requests;
}

const okBody = () => HttpResponse.json({ ok: true });
const tooMany =
  (headers: Record<string, string> = {}, body: JsonBodyType = { error: { status: 429 } }) =>
  () =>
    HttpResponse.json(body, { status: 429, headers });

describe("SpotifyHttp", () => {
  it("sends the bearer token and query, and returns the validated body", async () => {
    const { ping } = setup();
    const requests = serve(okBody);
    await expect(ping()).resolves.toEqual({ ok: true });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer access-token-1");
    expect(new URL(requests[0]!.url).search).toBe("?q=a+b");
  });

  it("makes no call while the shared gate is paused", async () => {
    const { ping, gate } = setup();
    gate.pausedUntil = new Date(T0 + 10_000);
    const requests = serve(okBody);
    await expect(ping()).rejects.toMatchObject({
      reason: "gate_paused",
      resumeAfter: gate.pausedUntil,
    });
    expect(requests).toHaveLength(0);
  });

  it("honours a pause another worker set right after a successful call (D-032)", async () => {
    const { ping, gate } = setup();
    const requests = serve(okBody);
    await ping();
    gate.pausedUntil = new Date(T0 + 3_600_000);
    await expect(ping()).rejects.toMatchObject({ reason: "gate_paused" });
    expect(requests).toHaveLength(1);
  });

  describe("429", () => {
    it("still waits and retries at exactly Retry-After: 120", async () => {
      const { ping, sleeps } = setup();
      const requests = serve(tooMany({ "Retry-After": "120" }), okBody);
      await expect(ping()).resolves.toEqual({ ok: true });
      expect(sleeps).toEqual([120_250]);
      expect(requests).toHaveLength(2);
    });

    it("pauses the gate for Retry-After (+ jitter), waits, and retries", async () => {
      const { ping, gate, sleeps } = setup();
      const requests = serve(tooMany({ "Retry-After": "2" }), okBody);
      await expect(ping()).resolves.toEqual({ ok: true });
      expect(gate.pausedUntil).toEqual(new Date(T0 + 2000 + 250));
      expect(sleeps).toEqual([2250]);
      expect(requests).toHaveLength(2);
    });

    it("accepts an HTTP-date Retry-After", async () => {
      const { ping, gate } = setup();
      serve(tooMany({ "Retry-After": new Date(T0 + 3000).toUTCString() }), okBody);
      await ping();
      expect(gate.pausedUntil).toEqual(new Date(T0 + 3000 + 250));
    });

    it("falls back to full jitter when Retry-After is missing or garbage", async () => {
      const { ping, sleeps } = setup();
      serve(tooMany(), tooMany({ "Retry-After": "soon" }), okBody);
      await ping();
      // attempt 1: 0.5 * 2s, attempt 2: 0.5 * 4s, each + 250ms pad.
      expect(sleeps).toEqual([1250, 2250]);
    });

    it("pauses the job instead of waiting when Retry-After is over 120s", async () => {
      const { ping, gate, sleeps } = setup();
      const requests = serve(tooMany({ "Retry-After": "5000" }), okBody);
      const error = await ping().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SpotifyBlockedError);
      expect(error).toMatchObject({
        reason: "long_retry_after",
        resumeAfter: new Date(T0 + 5_000_000),
      });
      expect(gate.pausedUntil).toEqual(new Date(T0 + 5_000_000));
      expect(requests).toHaveLength(1);
      expect(sleeps).toEqual([]);
    });

    it("pauses the job on QUOTA_EXCEEDED, even with a short Retry-After", async () => {
      const { ping, gate } = setup();
      serve(tooMany({ "Retry-After": "3" }, { error: { status: 429, reason: "QUOTA_EXCEEDED" } }));
      await expect(ping()).rejects.toMatchObject({
        reason: "quota_exceeded",
        resumeAfter: new Date(T0 + 3000),
      });
      expect(gate.pausedUntil).toEqual(new Date(T0 + 3000));
    });

    it("uses a one-hour pause for QUOTA_EXCEEDED without Retry-After", async () => {
      const { ping } = setup();
      serve(tooMany({}, { error: { reason: "QUOTA_EXCEEDED" } }));
      await expect(ping()).rejects.toMatchObject({ resumeAfter: new Date(T0 + 3_600_000) });
    });

    it("gives up after 5 attempts with the gate still paused", async () => {
      const { ping, gate } = setup();
      const requests = serve(tooMany({ "Retry-After": "1" }));
      const error = await ping().catch((e: unknown) => e);
      expect(error).toMatchObject({ reason: "gate_paused", resumeAfter: gate.pausedUntil });
      expect(gate.pausedUntil!.getTime()).toBeGreaterThan(T0);
      expect(requests).toHaveLength(5);
    });

    it("doesn't sleep through a longer pause another process set meanwhile", async () => {
      const { ping, gate, sleeps } = setup();
      serve(() => {
        gate.pausedUntil = new Date(T0 + 600_000);
        return tooMany({ "Retry-After": "1" })();
      });
      await expect(ping()).rejects.toMatchObject({
        reason: "gate_paused",
        resumeAfter: new Date(T0 + 600_000),
      });
      expect(sleeps).toEqual([]);
    });
  });

  describe("5xx and network errors", () => {
    it("retries with full jitter and succeeds", async () => {
      const { ping, sleeps } = setup();
      const requests = serve(
        () => new HttpResponse(null, { status: 503 }),
        () => HttpResponse.error(),
        okBody,
      );
      await expect(ping()).resolves.toEqual({ ok: true });
      expect(requests).toHaveLength(3);
      expect(sleeps).toEqual([1000, 2000]);
    });

    it("throws UpstreamError after 5 attempts and never logs the token", async () => {
      const { ping, logs } = setup();
      const requests = serve(() => new HttpResponse("boom", { status: 500 }));
      await expect(ping()).rejects.toBeInstanceOf(UpstreamError);
      expect(requests).toHaveLength(5);
      expect(JSON.stringify(logs)).not.toContain("access-token");
    });
  });

  describe("401", () => {
    it("refreshes the user token once and retries", async () => {
      const { ping, tokens } = setup();
      const requests = serve(() => new HttpResponse(null, { status: 401 }), okBody);
      await expect(ping({ kind: "user", userId: "u1" })).resolves.toEqual({ ok: true });
      expect(tokens.calls[1]).toEqual({
        caller: { kind: "user", userId: "u1" },
        rejected: "access-token-1",
      });
      expect(requests[1]?.headers.get("authorization")).toBe("Bearer access-token-2");
    });

    it("fails when the refreshed token is rejected too", async () => {
      const { ping } = setup();
      const requests = serve(() => new HttpResponse(null, { status: 401 }));
      await expect(ping({ kind: "user", userId: "u1" })).rejects.toBeInstanceOf(UpstreamError);
      expect(requests).toHaveLength(2);
    });

    it("does not refresh an explicit token", async () => {
      const { ping, tokens } = setup();
      const requests = serve(() => new HttpResponse(null, { status: 401 }));
      await expect(ping({ kind: "token", accessToken: "t" })).rejects.toBeInstanceOf(UpstreamError);
      expect(requests).toHaveLength(1);
      expect(tokens.calls).toHaveLength(0);
    });
  });

  it("doesn't retry other 4xx", async () => {
    const { ping } = setup();
    const requests = serve(() => HttpResponse.json({ error: { status: 404 } }, { status: 404 }));
    await expect(ping()).rejects.toBeInstanceOf(UpstreamError);
    expect(requests).toHaveLength(1);
  });

  it("rejects a body that fails validation", async () => {
    const { ping } = setup();
    serve(() => HttpResponse.json({ ok: "yes" }));
    await expect(ping()).rejects.toBeInstanceOf(UpstreamError);
  });

  it("keeps at most 3 calls in flight", async () => {
    const { ping } = setup();
    let active = 0;
    let peak = 0;
    server.use(
      mock.get(PING, async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return okBody();
      }),
    );
    await Promise.all(Array.from({ length: 7 }, () => ping()));
    expect(peak).toBe(3);
  });
});

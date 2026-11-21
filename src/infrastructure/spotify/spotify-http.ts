/**
 * The only path to api.spotify.com (LLD §8.2, D-006). Every call passes the shared gate, the
 * per-process rate limiter, and the 429/5xx/401 policy below. Tokens are never logged.
 */
import { z, type ZodType } from "zod";
import type { Clock, Random } from "@/application/ports/clock";
import {
  SpotifyBlockedError,
  type SpotifyCaller,
  type SpotifyGateStore,
} from "@/application/ports/spotify";
import { UpstreamError } from "@/lib/errors";
import { fullJitterSeconds, parseRetryAfter } from "./backoff";
import { SpotifyRateGate } from "./rate-gate";
import { SpotifyRateLimiter, type Sleep } from "./rate-limiter";

/** `token` is only for the sign-in callback, before the user's tokens are stored. */
export type SpotifyAuth = SpotifyCaller | { kind: "token"; accessToken: string };

export interface AccessTokenSource {
  /** `rejected`: a token Spotify just answered 401 to; return a different, refreshed one. */
  get(caller: SpotifyCaller, opts?: { rejected?: string }): Promise<string>;
}

export type SpotifyHttpConfig = {
  baseUrl: string;
  requestsPerSecond: number;
  maxInFlight: number;
  maxAttempts: number;
  /** A 429 asking for longer than this pauses the job instead of waiting (D-006). */
  maxWaitSeconds: number;
  /** Pause length for QUOTA_EXCEEDED without a Retry-After header. */
  quotaPauseSeconds: number;
};

export const DEFAULT_SPOTIFY_HTTP_CONFIG: SpotifyHttpConfig = {
  baseUrl: "https://api.spotify.com/v1",
  requestsPerSecond: 3,
  maxInFlight: 3,
  maxAttempts: 5,
  maxWaitSeconds: 120,
  quotaPauseSeconds: 3600,
};

export type SpotifyHttpDeps = {
  fetch: typeof fetch;
  clock: Clock;
  random: Random;
  sleep: Sleep;
  gate: SpotifyGateStore;
  tokens: AccessTokenSource;
  logger?: { warn(obj: object, msg: string): void };
  config?: Partial<SpotifyHttpConfig>;
};

export type SpotifyRequest<T> = {
  method: "GET" | "POST" | "PUT";
  /** Path below the base URL, e.g. `/search`. Callers must validate any ids they interpolate. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  auth: SpotifyAuth;
  schema: ZodType<T>;
};

const RATE_LIMIT_BODY = z.object({ error: z.object({ reason: z.string().optional() }) });
const JITTER_PAD_MS = 500;
const UPSTREAM = "spotify";

type CallState = { token: string; refreshed: boolean };

export class SpotifyHttp {
  private readonly config: SpotifyHttpConfig;
  private readonly gate: SpotifyRateGate;
  private readonly limiter: SpotifyRateLimiter;

  constructor(private readonly deps: SpotifyHttpDeps) {
    this.config = { ...DEFAULT_SPOTIFY_HTTP_CONFIG, ...deps.config };
    this.gate = new SpotifyRateGate(deps.gate, deps.clock);
    this.limiter = new SpotifyRateLimiter(this.config, deps.clock, deps.sleep);
  }

  /**
   * Sends one request and returns the validated JSON body.
   * Throws SpotifyBlockedError (gate/long 429/quota), ReauthRequiredError (from the token
   * source), or UpstreamError (other failures, after retries where they make sense).
   */
  async request<T>(req: SpotifyRequest<T>): Promise<T> {
    const state: CallState = { token: await this.tokenFor(req.auth), refreshed: false };
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      await this.gate.assertOpen();
      const res = await this.send(req, state.token);
      if (res?.ok) return this.parse(req, res);
      await this.handleFailure(req, res, attempt, state);
    }
    throw new UpstreamError(UPSTREAM, "Spotify kept failing. Try again in a moment.");
  }

  private async tokenFor(auth: SpotifyAuth, rejected?: string): Promise<string> {
    if (auth.kind === "token") return auth.accessToken;
    return this.deps.tokens.get(auth, rejected === undefined ? undefined : { rejected });
  }

  /** Returns null on a network error. */
  private async send<T>(req: SpotifyRequest<T>, token: string): Promise<Response | null> {
    const release = await this.limiter.acquire();
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (req.body !== undefined) headers["Content-Type"] = "application/json";
      return await this.deps.fetch(this.url(req), {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch (e) {
      this.deps.logger?.warn({ path: req.path, err: errorName(e) }, "spotify network error");
      return null;
    } finally {
      release();
    }
  }

  private url<T>(req: SpotifyRequest<T>): string {
    const url = new URL(this.config.baseUrl + req.path);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** Waits before the next attempt, or throws when this failure is final. */
  private async handleFailure<T>(
    req: SpotifyRequest<T>,
    res: Response | null,
    attempt: number,
    state: CallState,
  ): Promise<void> {
    const status = res?.status ?? 0;
    this.deps.logger?.warn({ path: req.path, status, attempt }, "spotify call failed");
    if (res && status === 429) return this.handleRateLimited(res, attempt);
    if (status === 401 && req.auth.kind !== "token" && !state.refreshed) {
      state.token = await this.tokenFor(req.auth, state.token);
      state.refreshed = true;
      return;
    }
    if (!res || status >= 500) {
      if (attempt >= this.config.maxAttempts) {
        throw new UpstreamError(UPSTREAM, "Spotify is having trouble. Try again in a moment.");
      }
      await this.deps.sleep(fullJitterSeconds(attempt, this.deps.random) * 1000);
      return;
    }
    throw new UpstreamError(UPSTREAM, `Spotify rejected the request (HTTP ${status}).`);
  }

  private async handleRateLimited(res: Response, attempt: number): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const body = RATE_LIMIT_BODY.safeParse(await res.json().catch(() => null));
    const quotaExceeded = body.success && body.data.error.reason === "QUOTA_EXCEEDED";
    const retryAfter = parseRetryAfter(res.headers.get("Retry-After"), new Date(now));

    if (quotaExceeded || (retryAfter ?? 0) > this.config.maxWaitSeconds) {
      const seconds = retryAfter ?? this.config.quotaPauseSeconds;
      const until = await this.gate.pauseUntil(new Date(now + seconds * 1000));
      throw new SpotifyBlockedError(quotaExceeded ? "quota_exceeded" : "long_retry_after", until);
    }

    const waitSeconds = retryAfter ?? fullJitterSeconds(attempt, this.deps.random);
    const jitterMs = this.deps.random.next() * JITTER_PAD_MS;
    const until = await this.gate.pauseUntil(new Date(now + waitSeconds * 1000 + jitterMs));
    const waitMs = until.getTime() - now;
    // Our own wait is at most maxWaitSeconds + the jitter pad. Anything longer means another
    // process set a longer pause: honour it without sleeping through it.
    const longestOwnWaitMs = this.config.maxWaitSeconds * 1000 + JITTER_PAD_MS;
    if (attempt >= this.config.maxAttempts || waitMs > longestOwnWaitMs) {
      throw new SpotifyBlockedError("gate_paused", until);
    }
    await this.deps.sleep(waitMs);
  }

  private async parse<T>(req: SpotifyRequest<T>, res: Response): Promise<T> {
    const raw: unknown = await res.json().catch(() => undefined);
    const parsed = req.schema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger?.warn(
        { path: req.path, issues: parsed.error.issues.slice(0, 5) },
        "spotify response failed validation",
      );
      throw new UpstreamError(UPSTREAM, "Spotify sent a response we didn't understand.");
    }
    return parsed.data;
  }
}

const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

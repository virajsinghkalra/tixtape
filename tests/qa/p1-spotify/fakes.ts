/** QA-owned fakes for P1 Spotify tests. Written from the ports, not the implementation. */
import type { Clock, Random } from "@/application/ports/clock";
import type { SpotifyCaller, SpotifyGateStore } from "@/application/ports/spotify";
import type {
  ActiveSession,
  SessionRepository,
  SpotifyTokenRepository,
  SpotifyTokenSet,
  StoredSpotifyToken,
  AuthUser,
  UserRepository,
  UserRole,
} from "@/application/auth/ports";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { SpotifyHttp, type SpotifyHttpConfig } from "@/infrastructure/spotify";

export const API = "https://api.spotify.com/v1";
export const T0 = Date.parse("2026-11-21T10:00:00.000Z");

export class FakeClock implements Clock {
  constructor(public t = T0) {}
  now(): Date {
    return new Date(this.t);
  }
}

export class SeqRandom implements Random {
  constructor(private readonly value = 0.5) {}
  next(): number {
    return this.value;
  }
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/**
 * Virtual time: `sleep` registers a timer; `run` drives the clock forward to the earliest timer
 * whenever the code under test is idle. No real waiting.
 */
export class VirtualTime {
  readonly clock: FakeClock;
  readonly sleeps: number[] = [];
  private timers: { at: number; resolve: () => void }[] = [];

  constructor(t = T0) {
    this.clock = new FakeClock(t);
  }

  sleep = (ms: number): Promise<void> => {
    this.sleeps.push(ms);
    return new Promise((resolve) =>
      this.timers.push({ at: this.clock.t + Math.max(0, ms), resolve }),
    );
  };

  async run<T>(p: Promise<T>): Promise<T> {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    let idle = 0;
    while (!done) {
      for (let i = 0; i < 5 && !done; i++) await flush();
      if (done) break;
      if (this.timers.length === 0) {
        if (++idle > 2000) throw new Error("VirtualTime: stuck with no timers");
        continue;
      }
      idle = 0;
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers.shift()!;
      this.clock.t = Math.max(this.clock.t, next.at);
      next.resolve();
    }
    return p;
  }
}

export class MemGate implements SpotifyGateStore {
  pausedUntil: Date | null = null;
  reads = 0;
  extensions: Date[] = [];
  async readPausedUntil(): Promise<Date | null> {
    this.reads++;
    return this.pausedUntil;
  }
  async extendPausedUntil(until: Date): Promise<Date> {
    this.extensions.push(until);
    if (!this.pausedUntil || until.getTime() > this.pausedUntil.getTime()) this.pausedUntil = until;
    return this.pausedUntil;
  }
}

export class FakeTokenSource {
  n = 0;
  calls: { caller: SpotifyCaller; rejected?: string }[] = [];
  async get(caller: SpotifyCaller, opts?: { rejected?: string }): Promise<string> {
    this.calls.push({ caller, rejected: opts?.rejected });
    this.n++;
    return `qa-access-token-${this.n}`;
  }
}

export type HttpRig = {
  http: SpotifyHttp;
  time: VirtualTime;
  gate: MemGate;
  tokens: FakeTokenSource;
  warnings: { obj: object; msg: string }[];
};

export function httpRig(config: Partial<SpotifyHttpConfig> = {}, random = 0.5): HttpRig {
  const time = new VirtualTime();
  const gate = new MemGate();
  const tokens = new FakeTokenSource();
  const warnings: { obj: object; msg: string }[] = [];
  const http = new SpotifyHttp({
    fetch: (input, init) => globalThis.fetch(input, init),
    clock: time.clock,
    random: new SeqRandom(random),
    sleep: time.sleep,
    gate,
    tokens,
    logger: { warn: (obj, msg) => warnings.push({ obj, msg }) },
    config,
  });
  return { http, time, gate, tokens, warnings };
}

// ── Auth fakes ─────────────────────────────────────────────────────────────

export class MemUsers implements UserRepository {
  rows = new Map<string, AuthUser>();
  async upsertBySpotifyId(input: {
    spotifyUserId: string;
    displayName: string | null;
    role: UserRole;
  }): Promise<AuthUser> {
    const existing = [...this.rows.values()].find((u) => u.spotifyUserId === input.spotifyUserId);
    const user: AuthUser = existing
      ? { ...existing, displayName: input.displayName, role: input.role }
      : {
          id: asUserId(`00000000-0000-4000-8000-${String(this.rows.size + 1).padStart(12, "0")}`),
          spotifyUserId: input.spotifyUserId,
          displayName: input.displayName,
          market: "IN",
          role: input.role,
        };
    this.rows.set(user.id, user);
    return user;
  }
  async findById(id: UserId): Promise<AuthUser | null> {
    return this.rows.get(id) ?? null;
  }
  async delete(id: UserId): Promise<void> {
    this.rows.delete(id);
  }
}

export class MemSessions implements SessionRepository {
  rows = new Map<string, { userId: UserId; expiresAt: Date; createdAt: Date }>();
  nowsSeen: Date[] = [];
  extensions: { sessionId: string; expiresAt: Date }[] = [];
  async create(
    sessionId: string,
    userId: UserId,
    expiresAt: Date,
    createdAt = new Date(T0),
  ): Promise<void> {
    this.rows.set(sessionId, { userId, expiresAt, createdAt });
  }
  async findUserId(sessionId: string, now: Date): Promise<UserId | null> {
    return (await this.find(sessionId, now))?.userId ?? null;
  }
  async find(sessionId: string, now: Date): Promise<ActiveSession | null> {
    this.nowsSeen.push(now);
    const r = this.rows.get(sessionId);
    if (!r || r.expiresAt.getTime() <= now.getTime()) return null;
    return { ...r };
  }
  async extend(sessionId: string, expiresAt: Date): Promise<void> {
    this.extensions.push({ sessionId, expiresAt });
    const r = this.rows.get(sessionId);
    if (r) this.rows.set(sessionId, { ...r, expiresAt });
  }
  async delete(sessionId: string): Promise<void> {
    this.rows.delete(sessionId);
  }
  async deleteExpired(now: Date): Promise<number> {
    let n = 0;
    for (const [id, r] of this.rows) {
      if (r.expiresAt.getTime() <= now.getTime()) {
        this.rows.delete(id);
        n++;
      }
    }
    return n;
  }
}

export class MemTokens implements SpotifyTokenRepository {
  rows = new Map<string, StoredSpotifyToken>();
  saves: { userId: UserId; tokens: SpotifyTokenSet }[] = [];
  reauthMarks: UserId[] = [];
  lockCalls = 0;
  private lock: Promise<void> = Promise.resolve();
  /** Hook run inside the lock before `fn`, e.g. to simulate another process refreshing. */
  onLock: (() => void) | null = null;

  async find(userId: UserId): Promise<StoredSpotifyToken | null> {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }
  async save(userId: UserId, tokens: SpotifyTokenSet): Promise<void> {
    this.saves.push({ userId, tokens });
    this.rows.set(userId, { ...tokens, userId, needsReauth: false });
  }
  async markNeedsReauth(userId: UserId): Promise<void> {
    this.reauthMarks.push(userId);
    const r = this.rows.get(userId);
    if (r) this.rows.set(userId, { ...r, needsReauth: true });
  }
  async withUserLock<T>(
    _userId: UserId,
    fn: (tokens: SpotifyTokenRepository) => Promise<T>,
  ): Promise<T> {
    this.lockCalls++;
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise((r) => (release = r));
    await prev;
    try {
      this.onLock?.();
      return await fn(this);
    } finally {
      release();
    }
  }
}

/** Returns the JSON-serialised form of anything, for "does this leak X" checks. */
export function dump(x: unknown): string {
  return JSON.stringify(x, (_k, v) =>
    v instanceof Error ? { ...v, message: v.message, stack: v.stack } : v,
  );
}

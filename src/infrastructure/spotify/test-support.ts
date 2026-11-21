/** Deterministic fakes for Spotify adapter tests. Not used by production code. */
import type { Clock, Random } from "@/application/ports/clock";
import type { SpotifyCaller, SpotifyGateStore } from "@/application/ports/spotify";
import type { AccessTokenSource } from "./spotify-http";

export const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

export class FakeClock implements Clock {
  constructor(public ms: number = T0) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** A sleep that advances the fake clock instead of waiting, and records each wait. */
export function fakeSleep(clock: FakeClock) {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
    clock.advance(ms);
  };
  return { sleep, calls };
}

export const fixedRandom = (value = 0.5): Random => ({ next: () => value });

export class MemoryGateStore implements SpotifyGateStore {
  pausedUntil: Date | null = null;
  reads = 0;
  async readPausedUntil(): Promise<Date | null> {
    this.reads++;
    return this.pausedUntil;
  }
  async extendPausedUntil(until: Date): Promise<Date> {
    if (!this.pausedUntil || until > this.pausedUntil) this.pausedUntil = until;
    return this.pausedUntil;
  }
}

/** Hands out `token`, or `refreshedToken` once a token has been rejected. */
export class StaticTokens implements AccessTokenSource {
  readonly calls: Array<{ caller: SpotifyCaller; rejected?: string }> = [];
  constructor(
    private readonly token = "access-token-1",
    private readonly refreshedToken = "access-token-2",
  ) {}
  async get(caller: SpotifyCaller, opts?: { rejected?: string }): Promise<string> {
    this.calls.push({ caller, rejected: opts?.rejected });
    return opts?.rejected ? this.refreshedToken : this.token;
  }
}

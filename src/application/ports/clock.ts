/** Injected so domain and application code stay deterministic in tests. */
export interface Clock {
  now(): Date;
}

export interface Random {
  /** A float in [0, 1). */
  next(): number;
}

export const systemClock: Clock = { now: () => new Date() };
export const systemRandom: Random = { next: () => Math.random() };

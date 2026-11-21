import type { Clock } from "@/application/ports/clock";
import { SpotifyBlockedError, type SpotifyGateStore } from "@/application/ports/spotify";

/**
 * The shared pause every process honours (D-006). The store is read before every request
 * (D-032): "open" is never cached, so a pause set by another worker applies at once. Only a
 * pause we already know is still active is remembered, to skip the read while it lasts.
 */
export class SpotifyRateGate {
  private knownPausedUntil: Date | null = null;

  constructor(
    private readonly store: SpotifyGateStore,
    private readonly clock: Clock,
  ) {}

  /** Throws SpotifyBlockedError("gate_paused") while a pause is in effect. */
  async assertOpen(): Promise<void> {
    const now = this.clock.now().getTime();
    if (!this.isActive(this.knownPausedUntil, now)) {
      this.knownPausedUntil = await this.store.readPausedUntil();
    }
    const pausedUntil = this.knownPausedUntil;
    if (pausedUntil && this.isActive(pausedUntil, now)) {
      throw new SpotifyBlockedError("gate_paused", pausedUntil);
    }
  }

  /** Extends the shared pause to at least `until`; returns the effective deadline. */
  async pauseUntil(until: Date): Promise<Date> {
    const effective = await this.store.extendPausedUntil(until);
    this.knownPausedUntil = effective;
    return effective;
  }

  private isActive(pausedUntil: Date | null, now: number): boolean {
    return pausedUntil !== null && pausedUntil.getTime() > now;
  }
}

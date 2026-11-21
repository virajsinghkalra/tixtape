/**
 * The auto-publish pause (D-073/D-074 safety valve). Stored in the `settings` table under
 * `auto_publish_paused_until`. The sweep pauses auto-publish when it spikes; the Gig Coverage
 * script must check `pausedUntil` before publishing anything automatically.
 */
export const AUTO_PUBLISH_PAUSED_UNTIL = "auto_publish_paused_until";

export interface AutoPublishPause {
  /** When auto-publish may resume, or null when it isn't paused (a past time counts as null). */
  pausedUntil(now: Date): Promise<Date | null>;
  pauseUntil(until: Date, reason: string): Promise<void>;
  resume(): Promise<void>;
}

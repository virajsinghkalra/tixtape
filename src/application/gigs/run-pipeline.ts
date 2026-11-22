/**
 * The gig run's step runner. A closed Spotify gate is a **soft skip**, not a failure:
 * - steps that need Spotify (artist validation) are deferred while the gate is closed, either
 *   known up front (`spotifyPausedUntil`) or found mid-run (`SpotifyBlockedError`, or a step
 *   reporting `blockedUntil`); later Spotify steps are deferred too;
 * - steps that don't need Spotify (press enrichment, the gate, re-verification) still run;
 * - any other error fails that step and the run (`failed`), but the remaining steps still run,
 *   so the report is complete.
 */
import { SpotifyBlockedError } from "@/application/ports/spotify";

export type PipelineStep = {
  name: string;
  needsSpotify: boolean;
  /** May return `{ blockedUntil: Date }` when Spotify stopped it part-way. */
  run(): Promise<unknown>;
};

export type StepResult =
  | { name: string; status: "done" }
  | { name: string; status: "deferred"; detail: string }
  | { name: string; status: "failed"; detail: string }
  | { name: string; status: "skipped"; detail: string };

export type PipelineReport = {
  steps: StepResult[];
  /** "deferred: spotify gate until …" lines, for the report and the job summary. */
  deferred: string[];
  /** True only for real errors: the run should exit non-zero. */
  failed: boolean;
};

const blockedUntilOf = (value: unknown): Date | null => {
  if (typeof value !== "object" || value === null || !("blockedUntil" in value)) return null;
  const until = (value as { blockedUntil: unknown }).blockedUntil;
  return until instanceof Date ? until : null;
};

export async function runPipeline(
  steps: readonly PipelineStep[],
  opts: { now: Date; spotifyPausedUntil: Date | null },
): Promise<PipelineReport> {
  const report: PipelineReport = { steps: [], deferred: [], failed: false };
  let gateUntil =
    opts.spotifyPausedUntil && opts.spotifyPausedUntil.getTime() > opts.now.getTime()
      ? opts.spotifyPausedUntil
      : null;
  const defer = (name: string, until: Date) => {
    const detail = `deferred: spotify gate until ${until.toISOString()}`;
    report.steps.push({ name, status: "deferred", detail });
    report.deferred.push(`${name}: ${detail}`);
  };
  for (const step of steps) {
    if (step.needsSpotify && gateUntil) {
      defer(step.name, gateUntil);
      continue;
    }
    try {
      const value = await step.run();
      const until = blockedUntilOf(value);
      if (until) {
        gateUntil = until;
        defer(step.name, until);
      } else {
        report.steps.push({ name: step.name, status: "done" });
      }
    } catch (e) {
      if (e instanceof SpotifyBlockedError) {
        gateUntil = e.resumeAfter;
        defer(step.name, e.resumeAfter);
        continue;
      }
      report.failed = true;
      report.steps.push({
        name: step.name,
        status: "failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return report;
}

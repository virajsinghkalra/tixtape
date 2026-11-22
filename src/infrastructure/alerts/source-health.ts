/**
 * D-060: alert when a collector source fails 3 runs in a row. Consecutive failures per source
 * are kept in a small JSON file between GitHub Actions runs (`actions/cache`).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Alert } from "@/application/ports/alerts";

export const FAILURES_BEFORE_ALERT = 3;
/** While a source stays down, remind about once a day (ingest runs every 3 hours). */
export const REMIND_EVERY_RUNS = 8;

export type SourceRun = { source: string; error: string | null };

const StateSchema = z.record(z.string(), z.number().int().min(0));
type State = z.infer<typeof StateSchema>;

/** Updates the counts and returns the alerts this run should send. Pure. */
export function trackSourceRuns(
  state: State,
  runs: readonly SourceRun[],
): { state: State; alerts: Alert[] } {
  const next = { ...state };
  const alerts: Alert[] = [];
  for (const run of runs) {
    const count = run.error ? (next[run.source] ?? 0) + 1 : 0;
    next[run.source] = count;
    const due =
      count >= FAILURES_BEFORE_ALERT && (count - FAILURES_BEFORE_ALERT) % REMIND_EVERY_RUNS === 0;
    if (!due) continue;
    alerts.push({
      key: `source-failing:${run.source}`,
      severity: "action",
      subject: `Event source "${run.source}" failed ${count} runs in a row`,
      body: `The scheduled ingest couldn't read "${run.source}" in its last ${count} runs.\n\nLast error: ${run.error}\n\nCheck the "Ingest events" workflow logs.`,
    });
  }
  return { state: next, alerts };
}

export async function loadSourceHealth(path: string): Promise<State> {
  try {
    const parsed = StateSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function saveSourceHealth(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state));
}

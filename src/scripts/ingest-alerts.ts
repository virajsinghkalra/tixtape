/**
 * Runs after the scheduled ingest (D-060): reads its `--report` JSON and alerts when a source
 * has failed 3 runs in a row. A missing or unreadable report means the whole run crashed, which
 * counts as a failure of the pseudo-source "ingest".
 *
 *   npx tsx src/scripts/ingest-alerts.ts <report.json>
 *
 * Kept separate from `ingest.ts` (owned by the Ingestion team) so it can't change ingest results.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  loadSourceHealth,
  saveSourceHealth,
  trackSourceRuns,
  type SourceRun,
} from "@/infrastructure/alerts/source-health";
import { systemClock } from "@/application/ports/clock";
import { createAlerts, ThrottledAlerts } from "@/infrastructure/alerts";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const STATE = "node_modules/.cache/lineupmixes/source-health.json";
const ALERT_STATE = "node_modules/.cache/lineupmixes/alerts-ingest.json";
const ReportSchema = z.object({
  sources: z.array(z.object({ source: z.string(), error: z.string().nullish() })),
});

async function runsFrom(path: string | undefined): Promise<SourceRun[]> {
  try {
    if (!path) throw new Error("no report path given");
    const report = ReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return [
      { source: "ingest", error: null },
      ...report.sources.map((s) => ({ source: s.source, error: s.error ?? null })),
    ];
  } catch (e) {
    return [
      { source: "ingest", error: `no ingest report (${e instanceof Error ? e.message : e})` },
    ];
  }
}

async function main(): Promise<void> {
  const runs = await runsFrom(process.argv[2]);
  const { state, alerts } = trackSourceRuns(await loadSourceHealth(STATE), runs);
  await saveSourceHealth(STATE, state);
  // D-060 addendum: a lasting failure fails the run at most once a day.
  const sink = new ThrottledAlerts(createAlerts({ env: env(), logger }), ALERT_STATE, systemClock);
  for (const alert of alerts) await sink.send(alert);
  console.warn(
    `source health: ${Object.entries(state)
      .map(([s, n]) => `${s}=${n}`)
      .join(" ")}; alerts=${alerts.length}`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

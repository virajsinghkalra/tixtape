/**
 * $0 fallback when SMTP isn't configured (D-060): the alert goes to the GitHub Actions job
 * summary and an error annotation, and the job is marked failed so GitHub's own failed-run
 * email reaches the repository owner.
 */
import { appendFile } from "node:fs/promises";
import type { Alert, Alerts } from "@/application/ports/alerts";

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export class JobSummaryAlerts implements Alerts {
  constructor(
    private readonly summaryPath: string,
    private readonly failJob: boolean,
  ) {}

  async send(alert: Alert): Promise<void> {
    await appendFile(this.summaryPath, `### Alert: ${oneLine(alert.subject)}\n\n${alert.body}\n\n`);
    console.error(
      `::error title=${oneLine(alert.subject).replace(/[:,]/g, " ")}::${oneLine(alert.body)}`,
    );
    if (this.failJob) process.exitCode = 1;
  }
}

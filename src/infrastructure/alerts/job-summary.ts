/**
 * $0 fallback when SMTP isn't configured (D-060): the alert goes to the GitHub Actions job
 * summary. Only an `action` alert (D-060 addendum) adds an error annotation and marks the job
 * failed, so GitHub's own failed-run email reaches the owner; `info` (digests, held events)
 * is a notice and the run stays green.
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
    const action = alert.severity === "action";
    const label = action ? "Action needed" : "Info";
    await appendFile(
      this.summaryPath,
      `### ${label}: ${oneLine(alert.subject)}\n\n${alert.body}\n\n`,
    );
    const level = action ? "error" : "notice";
    console.error(
      `::${level} title=${oneLine(alert.subject).replace(/[:,]/g, " ")}::${oneLine(alert.body)}`,
    );
    if (this.failJob && action) process.exitCode = 1;
  }
}

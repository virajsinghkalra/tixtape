/**
 * Alerts wiring (D-060). Every alert is logged. It is also emailed when `ALERT_SMTP_USER` and
 * `ALERT_SMTP_PASS` are set (Gmail app password), and written to the GitHub Actions job summary
 * when running in Actions. Without SMTP, the job summary alert also fails the job, so GitHub
 * emails the repository owner.
 */
import type { Alert, Alerts } from "@/application/ports/alerts";
import type { Env } from "@/lib/env";
import type { Logger } from "@/lib/logger";
import { JobSummaryAlerts } from "./job-summary";
import { SmtpAlerts } from "./smtp";

export { SmtpAlerts } from "./smtp";
export { JobSummaryAlerts } from "./job-summary";
export { ThrottledAlerts } from "./throttle";

type AlertEnv = Pick<
  Env,
  | "ALERT_SMTP_HOST"
  | "ALERT_SMTP_PORT"
  | "ALERT_SMTP_USER"
  | "ALERT_SMTP_PASS"
  | "ALERT_EMAIL_TO"
  | "GITHUB_STEP_SUMMARY"
>;

export function createAlerts(deps: { env: AlertEnv; logger: Pick<Logger, "warn" | "error"> }) {
  const { env, logger } = deps;
  const sinks: Alerts[] = [];
  const hasSmtp = Boolean(env.ALERT_SMTP_USER && env.ALERT_SMTP_PASS);
  if (env.ALERT_SMTP_USER && env.ALERT_SMTP_PASS) {
    sinks.push(
      new SmtpAlerts({
        host: env.ALERT_SMTP_HOST,
        port: env.ALERT_SMTP_PORT,
        user: env.ALERT_SMTP_USER,
        pass: env.ALERT_SMTP_PASS,
        to: env.ALERT_EMAIL_TO,
      }),
    );
  }
  if (env.GITHUB_STEP_SUMMARY) sinks.push(new JobSummaryAlerts(env.GITHUB_STEP_SUMMARY, !hasSmtp));
  return {
    async send(alert: Alert): Promise<void> {
      logger.warn({ alert: alert.key, subject: alert.subject }, "alert");
      const results = await Promise.allSettled(sinks.map((s) => s.send(alert)));
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        logger.error({ alert: alert.key, err: failures[0]!.reason }, "alert delivery failed");
        process.exitCode = 1;
      }
    },
  } satisfies Alerts;
}

/** Operator alerts (D-060): sent to the app mailbox, never to users. */
export type Alert = {
  /** Stable per condition, e.g. `source-failing:wikipedia`; used to avoid repeats. */
  key: string;
  subject: string;
  /** Plain text. Never include secrets or tokens. */
  body: string;
  /**
   * D-060 addendum: `action` needs the operator (a source failing 3 runs in a row, the
   * publisher needing reauth, the auto-publish spike pause); without SMTP it fails the job so
   * GitHub emails the owner, at most once a day. `info` (the default: digests, held events)
   * only goes to the email and the job summary.
   */
  severity?: AlertSeverity;
};

export type AlertSeverity = "info" | "action";

export interface Alerts {
  send(alert: Alert): Promise<void>;
}

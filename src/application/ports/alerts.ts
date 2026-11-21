/** Operator alerts (D-060): sent to the app mailbox, never to users. */
export type Alert = {
  /** Stable per condition, e.g. `source-failing:wikipedia`; used to avoid repeats. */
  key: string;
  subject: string;
  /** Plain text. Never include secrets or tokens. */
  body: string;
};

export interface Alerts {
  send(alert: Alert): Promise<void>;
}

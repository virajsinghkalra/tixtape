/**
 * Scheduled jobs run every 30 minutes to 3 hours, so a condition that lasts would alert on
 * every run. This sends an alert again only when its text changed or a day has passed. State
 * is a small JSON file, kept between GitHub Actions runs with `actions/cache`.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { Alert, Alerts } from "@/application/ports/alerts";
import type { Clock } from "@/application/ports/clock";

export const REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;

const StateSchema = z.record(z.string(), z.object({ hash: z.string(), sentAt: z.string() }));
type State = z.infer<typeof StateSchema>;

const hashOf = (a: Alert) => createHash("sha256").update(`${a.subject}\n${a.body}`).digest("hex");

export class ThrottledAlerts implements Alerts {
  constructor(
    private readonly inner: Alerts,
    private readonly statePath: string,
    private readonly clock: Clock,
  ) {}

  private async load(): Promise<State> {
    try {
      const parsed = StateSchema.safeParse(JSON.parse(await readFile(this.statePath, "utf8")));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  async send(alert: Alert): Promise<void> {
    const state = await this.load();
    const now = this.clock.now();
    const last = state[alert.key];
    const hash = hashOf(alert);
    const recent = last && now.getTime() - new Date(last.sentAt).getTime() < REPEAT_AFTER_MS;
    if (last && last.hash === hash && recent) return;
    await this.inner.send(alert);
    state[alert.key] = { hash, sentAt: now.toISOString() };
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state));
  }
}

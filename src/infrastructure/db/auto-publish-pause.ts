/** The auto-publish pause in the `settings` table (D-073/D-074). */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AUTO_PUBLISH_PAUSED_UNTIL, type AutoPublishPause } from "@/application/ports/auto-publish";
import type { Database } from "@/db/client";
import { settings } from "@/db/schema";

const PauseValue = z.object({ until: z.iso.datetime({ offset: true }), reason: z.string() });

export class PgAutoPublishPause implements AutoPublishPause {
  constructor(private readonly db: Database) {}

  async pausedUntil(now: Date): Promise<Date | null> {
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, AUTO_PUBLISH_PAUSED_UNTIL));
    if (!rows[0]) return null;
    const parsed = PauseValue.safeParse(rows[0].value);
    // An unreadable value fails safe: treat auto-publish as paused until someone fixes it.
    if (!parsed.success) return new Date(8.64e15);
    const until = new Date(parsed.data.until);
    return until > now ? until : null;
  }

  async pauseUntil(until: Date, reason: string): Promise<void> {
    const value = { until: until.toISOString(), reason };
    await this.db
      .insert(settings)
      .values({ key: AUTO_PUBLISH_PAUSED_UNTIL, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
  }

  async resume(): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, AUTO_PUBLISH_PAUSED_UNTIL));
  }
}

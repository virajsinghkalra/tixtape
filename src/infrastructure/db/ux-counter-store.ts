/** D-084 (OD-4): Postgres UX counters, an upsert-increment per (IST day, metric). */
import { sql } from "drizzle-orm";
import type { UxCounterStore } from "@/application/ports/ux-counters";
import type { Database } from "@/db/client";
import { uxCounters } from "@/db/schema";
import { isoDate } from "@/domain/gigs/extract";
import type { UxMetric } from "@/domain/ux/counters";

export class PgUxCounterStore implements UxCounterStore {
  constructor(private readonly db: Database) {}

  async increment(metric: UxMetric, at: Date): Promise<void> {
    await this.db
      .insert(uxCounters)
      .values({ day: isoDate(at), metric, count: 1 })
      .onConflictDoUpdate({
        target: [uxCounters.day, uxCounters.metric],
        set: { count: sql`${uxCounters.count} + 1` },
      });
  }
}

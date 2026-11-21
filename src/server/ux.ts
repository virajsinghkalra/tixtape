/**
 * D-084 (OD-4): counts a UX metric after the response is sent (`after`), the D-081 way. A
 * failure is only logged: measurement must never slow down or break a page or an image.
 */
import { after } from "next/server";
import type { UxMetric } from "@/domain/ux/counters";
import { PgUxCounterStore } from "@/infrastructure/db/ux-counter-store";
import { container } from "@/server/container";

export function noteUx(metric: UxMetric): void {
  try {
    after(async () => {
      const c = container();
      try {
        await new PgUxCounterStore(c.db).increment(metric, c.clock.now());
      } catch (e) {
        c.logger.warn({ err: e, metric }, "ux: failed to count a metric");
      }
    });
  } catch {
    // Outside a request (tests, static rendering) there is nothing to count.
  }
}

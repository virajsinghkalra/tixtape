import type { UxMetric } from "@/domain/ux/counters";

/** D-084 (OD-4): aggregate UX counters. One count per (IST day, metric); nothing personal. */
export interface UxCounterStore {
  /** Adds one to `metric` on `at`'s IST day. */
  increment(metric: UxMetric, at: Date): Promise<void>;
}

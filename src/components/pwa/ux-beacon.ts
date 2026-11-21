import type { UxEvent, Vital } from "@/domain/ux/counters";

/**
 * D-084 (OD-4): fire-and-forget aggregate counters. `sendBeacon` survives page unloads; a
 * failure is ignored, because measurement never gets in the visitor's way.
 */
export function sendUx(body: { metric: UxEvent } | { vital: Vital; value: number; path: string }) {
  try {
    const payload = JSON.stringify(body);
    if (navigator.sendBeacon?.("/api/ux", payload)) return;
    void fetch("/api/ux", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  } catch {
    // Counting is best-effort.
  }
}

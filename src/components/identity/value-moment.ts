import type { ContactSource } from "@/domain/analytics/identity";

/**
 * D-090: a moment of value (Ping me, Follow, Remind me, a playlist landing). `IdentityPrompts`
 * listens and may offer "Email me too? ✉️". Fired whether or not tracking is allowed: it's a
 * UI cue, not a measurement.
 */
export const VALUE_EVENT = "tixtape:value";

export function valueMoment(source: ContactSource): void {
  try {
    window.dispatchEvent(new CustomEvent<ContactSource>(VALUE_EVENT, { detail: source }));
  } catch {
    // Outside a browser: nothing to show.
  }
}

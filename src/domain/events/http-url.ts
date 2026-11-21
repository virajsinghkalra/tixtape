import { z } from "zod";

/**
 * The only URL shape allowed into the app (ENGINEERING.md §7): absolute http(s), ≤ 2000 chars.
 * `z.url()` alone accepts `javascript:` and `data:`, which become XSS once rendered as a link.
 */
export const httpUrl = () => z.url({ protocol: /^https?$/u }).max(2000);

/** The URL if it passes `httpUrl`, else undefined. For optional third-party fields. */
export function safeHttpUrl(raw: string | undefined): string | undefined {
  return raw !== undefined && httpUrl().safeParse(raw).success ? raw : undefined;
}

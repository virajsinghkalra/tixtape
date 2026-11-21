/**
 * Reads `events.verification` (D-056) back for the admin event screen. The column is jsonb,
 * so it's validated here (ENGINEERING.md §3) instead of trusted as `Verification`.
 */
import { z } from "zod";

const evidence = z.object({
  source: z.string(),
  url: z.string(),
  trust: z.string(),
  official: z.boolean(),
});

const field = z.object({
  value: z.string().nullable(),
  status: z.enum(["verified", "official", "single", "conflict", "missing"]),
  agreeing: z.array(evidence),
  independent: z.number(),
  disagreeing: z.array(evidence.extend({ value: z.string() })),
});

const artist = z.object({
  name: z.string(),
  confirmed: z.boolean(),
  sources: z.number(),
  official: z.boolean(),
  identity: z.enum(["active", "inactive", "unknown"]),
});

export const StoredVerificationSchema = z.object({
  checkedAt: z.string(),
  fields: z.object({
    date: field,
    city: field,
    venue: field,
    headliners: field.extend({ artists: z.array(artist) }),
  }),
  checks: z.array(
    z.object({
      layer: z.number().int(),
      name: z.string(),
      ok: z.boolean().nullable(),
      detail: z.string(),
    }),
  ),
  flags: z.array(z.string()),
  independentSources: z.number(),
  confidence: z.number(),
  passes: z.boolean(),
});

export type StoredVerification = z.infer<typeof StoredVerificationSchema>;
export type StoredFieldVerification = z.infer<typeof field>;

export type VerificationView =
  | { state: "verified"; verification: StoredVerification }
  /** Never run through the collector's checks (e.g. entered by an admin). */
  | { state: "none" }
  /** Stored in an older or broken shape; shown as such rather than guessed at. */
  | { state: "unreadable" };

export function readVerification(raw: unknown): VerificationView {
  if (raw === null || raw === undefined) return { state: "none" };
  const parsed = StoredVerificationSchema.safeParse(raw);
  return parsed.success
    ? { state: "verified", verification: parsed.data }
    : { state: "unreadable" };
}
